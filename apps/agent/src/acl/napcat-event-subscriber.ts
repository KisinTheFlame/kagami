import { AppLogger } from "@kagami/kernel/logger/logger";
import {
  NAPCAT_EVENTS_SSE_PATH,
  NapcatAgentEventSchema,
  type NapcatAgentEvent,
} from "@kagami/napcat-api/event";

const logger = new AppLogger({ source: "agent.napcat-subscriber" });

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// 30s 内无任何帧（含 15s 心跳）判连接半开：主动 abort 重连。留出 2 个心跳周期的裕量。
const DEAD_CONNECTION_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/** 持久游标：跨 agent 重启记住「已消费到的 seq」，重连时作 Last-Event-ID。 */
export interface NapcatCursorStore {
  load(): Promise<number>;
  save(seq: number): Promise<void>;
}

type NapcatEventSubscriberDeps = {
  baseUrl: string;
  onEvent: (event: NapcatAgentEvent) => void | Promise<void>;
  cursorStore: NapcatCursorStore;
  fetch?: FetchLike;
};

/**
 * agent 侧入站事件订阅者（issue #347）：长连 kagami-napcat 的 `GET /napcat/events` SSE 流，解析
 * `id:<seq>\ndata:<event>\n\n` 帧，喂给 onEvent（QqApp.handleNapcatEvent），**处理成功后**落持久
 * 游标。断线自动重连（指数退避 1s→30s）+ 30s 无帧的半开检测（主动 abort 重连），重连带
 * Last-Event-ID 让 napcat 回放缺口。按 seq 单调去重（seq <= 已消费则丢弃），配合 napcat 侧
 * outbox 的严格 at-least-once，保证 agent / napcat 任一重启都不丢不重。
 */
export class NapcatEventSubscriber {
  private readonly baseUrl: string;
  private readonly onEvent: (event: NapcatAgentEvent) => void | Promise<void>;
  private readonly cursorStore: NapcatCursorStore;
  private readonly fetchImpl: FetchLike;
  private running = false;
  private controller: AbortController | null = null;
  private lastConsumedSeq = 0;

  public constructor({
    baseUrl,
    onEvent,
    cursorStore,
    fetch: fetchImpl,
  }: NapcatEventSubscriberDeps) {
    this.baseUrl = baseUrl;
    this.onEvent = onEvent;
    this.cursorStore = cursorStore;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** 启动后台订阅循环（不阻塞）。 */
  public async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastConsumedSeq = await this.cursorStore.load();
    void this.loop();
  }

  public stop(): void {
    this.running = false;
    this.controller?.abort();
  }

  private async loop(): Promise<void> {
    let backoffMs = INITIAL_BACKOFF_MS;
    while (this.running) {
      try {
        await this.connectOnce();
        // 服务端干净关闭（如 napcat 重启）：立即以最小退避重连。
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (error) {
        if (this.running) {
          logger.warn("napcat SSE connection dropped, will retry", {
            event: "napcat.sse.connection_dropped",
            backoffMs,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!this.running) {
        break;
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  private async connectOnce(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;

    // 半开检测：每收到一帧就重置；DEAD_CONNECTION_TIMEOUT_MS 内无帧则 abort、触发重连。
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = (): void => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
      }
      watchdog = setTimeout(() => controller.abort(), DEAD_CONNECTION_TIMEOUT_MS);
      watchdog.unref?.();
    };

    try {
      armWatchdog();
      const response = await this.fetchImpl(`${this.baseUrl}${NAPCAT_EVENTS_SSE_PATH}`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "Last-Event-ID": String(this.lastConsumedSeq),
        },
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        throw new Error(`napcat SSE responded ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        armWatchdog();
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          await this.handleFrame(frame);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } finally {
      if (watchdog !== null) {
        clearTimeout(watchdog);
      }
    }
  }

  private async handleFrame(frame: string): Promise<void> {
    let idRaw: string | undefined;
    let dataRaw: string | undefined;
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) {
        // 注释帧（心跳）：只用于保活 / 喂看门狗，无内容。
        continue;
      }
      if (line.startsWith("id:")) {
        idRaw = line.slice(3).trim();
      } else if (line.startsWith("data:")) {
        dataRaw = line.slice(5).trim();
      }
    }
    if (dataRaw === undefined) {
      return;
    }
    const seq = Number(idRaw);
    if (!Number.isInteger(seq) || seq <= this.lastConsumedSeq) {
      // 去重：重连回放 / 重叠会重发 seq <= 已消费，丢弃。
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(dataRaw);
    } catch {
      logger.warn("napcat SSE frame data not JSON, skipped", {
        event: "napcat.sse.bad_frame",
        seq,
      });
      return;
    }
    const parsed = NapcatAgentEventSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn("napcat SSE event failed schema, skipped", {
        event: "napcat.sse.invalid_event",
        seq,
      });
      return;
    }

    // 处理成功后才推进 + 落游标（处理中崩溃 → 重启回放同一 seq 幂等重放）。
    await this.onEvent(parsed.data);
    this.lastConsumedSeq = seq;
    await this.cursorStore.save(seq);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
