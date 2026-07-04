import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { NAPCAT_EVENTS_SSE_PATH, type NapcatOutboxEvent } from "@kagami/napcat-api/event";
import {
  serializeEventFrame,
  type NapcatEventBroadcaster,
  type NapcatEventSubscriber,
} from "../application/napcat-event-broadcaster.js";
import type { NapcatEventOutboxDao } from "../infra/napcat-event-outbox.dao.js";

const logger = new AppLogger({ source: "napcat.events-handler" });

/** 单次回放的批大小（避免一口气把超长缺口全查进内存）。 */
const REPLAY_BATCH_SIZE = 500;

type NapcatEventsHandlerDeps = {
  broadcaster: NapcatEventBroadcaster;
  outboxDao: NapcatEventOutboxDao;
};

/**
 * SSE 入站事件端点 `GET /napcat/events`：agent 拨出订阅、napcat 在同一长连接上推流。裸
 * ServerResponse（reply.hijack）承载 `text/event-stream`；重连带 `Last-Event-ID` 回放 outbox 缺口。
 *
 * 交接顺序保证无丢/无乱序/无重：先 `broadcaster.add`（此刻起实时事件先进订阅者缓冲）→ 回放
 * outbox(lastEventId, now] → flush 缓冲（按 seq 去重 replay 已发过的）→ 转实时。
 */
export class NapcatEventsHandler {
  private readonly broadcaster: NapcatEventBroadcaster;
  private readonly outboxDao: NapcatEventOutboxDao;

  public constructor({ broadcaster, outboxDao }: NapcatEventsHandlerDeps) {
    this.broadcaster = broadcaster;
    this.outboxDao = outboxDao;
  }

  public register(app: FastifyInstance): void {
    app.get(NAPCAT_EVENTS_SSE_PATH, async (request, reply) => {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // 反代（如 nginx）默认缓冲会破坏 SSE 实时性——显式关掉。
        "X-Accel-Buffering": "no",
      });

      const lastEventId = parseLastEventId(request);
      const subscriber = new NapcatSseSubscriber({
        write: chunk => res.write(chunk),
        outboxDao: this.outboxDao,
        lastEventId,
      });

      // 先 add：回放期间到达的实时事件先进订阅者缓冲，不会丢、也不会抢先推进游标。
      this.broadcaster.add(subscriber);
      res.on("close", () => this.broadcaster.remove(subscriber));

      try {
        await subscriber.start();
      } catch (error) {
        logger.errorWithCause("SSE replay failed on connect", error, {
          event: "napcat.sse.replay_failed",
          lastEventId,
        });
        this.broadcaster.remove(subscriber);
        res.end();
      }
    });
  }
}

type NapcatSseSubscriberDeps = {
  write: (chunk: string) => void;
  outboxDao: NapcatEventOutboxDao;
  lastEventId: number;
};

/**
 * 一条 SSE 连接的订阅者：负责「缓冲实时 → 回放 outbox → flush 缓冲 → 转实时」的交接，并以
 * `lastWrittenSeq` 单调去重（同一 seq 只发一次）。attach 之后、start() 之前的实时事件进缓冲；
 * start() 回放缺口后 flush 缓冲、切实时。
 */
class NapcatSseSubscriber implements NapcatEventSubscriber {
  private readonly write: (chunk: string) => void;
  private readonly outboxDao: NapcatEventOutboxDao;
  private phase: "buffering" | "live" = "buffering";
  private readonly buffer: NapcatOutboxEvent[] = [];
  private lastWrittenSeq: number;

  public constructor({ write, outboxDao, lastEventId }: NapcatSseSubscriberDeps) {
    this.write = write;
    this.outboxDao = outboxDao;
    this.lastWrittenSeq = lastEventId;
  }

  public deliver(outboxEvent: NapcatOutboxEvent): void {
    if (this.phase === "buffering") {
      this.buffer.push(outboxEvent);
      return;
    }
    this.writeIfNew(outboxEvent);
  }

  public heartbeat(): void {
    this.write(": keepalive\n\n");
  }

  /** 回放 outbox 缺口 → flush 缓冲 → 转实时。 */
  public async start(): Promise<void> {
    let cursor = this.lastWrittenSeq;
    for (;;) {
      const batch = await this.outboxDao.listAfter(cursor, REPLAY_BATCH_SIZE);
      if (batch.length === 0) {
        break;
      }
      for (const event of batch) {
        this.writeIfNew(event);
      }
      cursor = batch[batch.length - 1]!.seq;
    }
    // flush 回放期间缓冲下来的实时事件（按 seq 升序，writeIfNew 去掉与回放的重叠）。
    this.buffer.sort((a, b) => a.seq - b.seq);
    for (const event of this.buffer) {
      this.writeIfNew(event);
    }
    this.buffer.length = 0;
    this.phase = "live";
  }

  private writeIfNew(outboxEvent: NapcatOutboxEvent): void {
    if (outboxEvent.seq <= this.lastWrittenSeq) {
      return;
    }
    this.write(serializeEventFrame(outboxEvent));
    this.lastWrittenSeq = outboxEvent.seq;
  }
}

/**
 * 解析重连游标：优先标准 `Last-Event-ID` 头（agent 侧 SSE 客户端重连时带），回退查询参数
 * `?lastEventId=`。缺失 / 非法 → 0（从头回放，靠 prune 保留窗口兜底）。
 */
function parseLastEventId(request: FastifyRequest): number {
  const header = request.headers["last-event-id"];
  const raw = Array.isArray(header) ? header[0] : header;
  const fromHeader = raw !== undefined ? Number(raw) : NaN;
  if (Number.isInteger(fromHeader) && fromHeader >= 0) {
    return fromHeader;
  }
  const query = (request.query as Record<string, unknown> | undefined)?.lastEventId;
  const fromQuery = typeof query === "string" ? Number(query) : NaN;
  if (Number.isInteger(fromQuery) && fromQuery >= 0) {
    return fromQuery;
  }
  return 0;
}
