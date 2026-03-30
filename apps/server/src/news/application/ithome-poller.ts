import { AppLogger } from "../../logger/logger.js";
import type { IthomeNewsService } from "./ithome-news.service.js";

const logger = new AppLogger({ source: "news.ithome-poller" });

export class IthomePoller {
  private readonly ithomeNewsService: IthomeNewsService;
  private readonly pollIntervalMs: number;
  private readonly onArticleIngested: (input: { articleId: number; title: string }) => void;
  private timer: NodeJS.Timeout | null = null;
  private pollPromise: Promise<void> | null = null;

  public constructor({
    ithomeNewsService,
    pollIntervalMs,
    onArticleIngested,
  }: {
    ithomeNewsService: IthomeNewsService;
    pollIntervalMs: number;
    onArticleIngested: (input: { articleId: number; title: string }) => void;
  }) {
    this.ithomeNewsService = ithomeNewsService;
    this.pollIntervalMs = pollIntervalMs;
    this.onArticleIngested = onArticleIngested;
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  public close(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.pollPromise) {
      return;
    }

    this.pollPromise = this.runPoll();
    try {
      await this.pollPromise;
    } finally {
      this.pollPromise = null;
    }
  }

  private async runPoll(): Promise<void> {
    try {
      const result = await this.ithomeNewsService.syncFeed();
      for (const article of result.newArticles) {
        this.onArticleIngested(article);
      }
    } catch (error) {
      logger.warn("Failed to poll ithome rss feed", {
        event: "news.ithome_poll_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
