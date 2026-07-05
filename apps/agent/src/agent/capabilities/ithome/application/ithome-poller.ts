import { AppLogger } from "@kagami/kernel/logger/logger";
import type { IthomeService } from "./ithome.service.js";

const logger = new AppLogger({ source: "ithome.poller" });

const BEIJING_TIME_ZONE = "Asia/Shanghai";
/**
 * 深夜静默窗（北京时间，凌晨 1 点到上午 9 点），与 inner-voice 的作息窗对齐
 * （见 inner-voice/domain/idle-detector.ts 的 INNER_VOICE_IDLE_POLICY）：小镜有自己的节奏，
 * 深夜不该被 RSS 新文敲门。窗内仍照常 syncFeed（DB 保持最新、去重游标继续前进），只是**不投通知**——
 * 既不半夜打扰，也不会把整夜的新文攒到早上一次性涌成一大批。
 */
const QUIET_START_HOUR = 1;
const QUIET_END_HOUR = 9;

export class IthomePoller {
  private readonly ithomeService: IthomeService;
  public readonly pollIntervalMs: number;
  private readonly onArticleIngested: (input: { articleId: number; title: string }) => void;
  private readonly now: () => Date;

  public constructor({
    ithomeService,
    pollIntervalMs,
    onArticleIngested,
    now,
  }: {
    ithomeService: IthomeService;
    pollIntervalMs: number;
    onArticleIngested: (input: { articleId: number; title: string }) => void;
    /** 取当前时刻（可注入以便测试静默窗）。默认 `() => new Date()`。 */
    now?: () => Date;
  }) {
    this.ithomeService = ithomeService;
    this.pollIntervalMs = pollIntervalMs;
    this.onArticleIngested = onArticleIngested;
    this.now = now ?? (() => new Date());
  }

  public async runOnce(): Promise<void> {
    try {
      const result = await this.ithomeService.syncFeed();
      // 静默窗内：文章已入库、游标已前进，但不敲门（不投通知）。窗外照常投递。
      if (isQuietHour(this.now())) {
        if (result.newArticles.length > 0) {
          logger.info("ithome new articles ingested during quiet hours, notification suppressed", {
            event: "ithome.poll.quiet_hours_suppressed",
            suppressedCount: result.newArticles.length,
          });
        }
        return;
      }
      for (const article of result.newArticles) {
        this.onArticleIngested(article);
      }
    } catch (error) {
      logger.warn("Failed to poll ithome rss feed", {
        event: "ithome.poll_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** 北京时间是否落在深夜静默窗 [QUIET_START_HOUR, QUIET_END_HOUR)。 */
function isQuietHour(date: Date): boolean {
  const hour = getBeijingHour(date);
  return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

/** 北京时间的小时数（0–23）。与 inner-voice 的 getBeijingHour 同一实现，避免跨 capability 依赖。 */
function getBeijingHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find(part => part.type === "hour")?.value ?? "0";
  // Intl 的 hour12:false 在部分环境把 0 点格式化成 "24"，归一到 0。
  return Number.parseInt(hourPart, 10) % 24;
}
