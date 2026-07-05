import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createBackpressureAwareWrite } from "@kagami/http/sse";
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

/** SSE 背压宽限期：res.write 背压后等 drain 这么久，还不 drain 就销毁连接（消费方视为真死/半开）。 */
const SSE_BACKPRESSURE_GRACE_MS = 15_000;

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

      const write = createBackpressureAwareWrite(res, SSE_BACKPRESSURE_GRACE_MS, () => {
        logger.warn("SSE 背压超时，销毁连接等 agent 重连回放", {
          event: "napcat.sse.backpressure_timeout",
        });
      });

      const lastEventId = parseLastEventId(request);
      const subscriber = new NapcatSseSubscriber({
        write,
        close: () => res.end(),
        outboxDao: this.outboxDao,
        lastEventId,
      });

      // 先 add：回放期间到达的实时事件先进订阅者缓冲，不会丢、也不会抢先推进游标。
      this.broadcaster.add(subscriber);
      // 客户端断连也置位 subscriber.closed（幂等），让在飞的 start() 回放停手、不写已关的 res。
      res.on("close", () => {
        subscriber.close();
        this.broadcaster.remove(subscriber);
      });

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

export type NapcatSseSubscriberDeps = {
  write: (chunk: string) => void;
  /** 结束底层连接（关停 teardown 用）。缺省为 no-op（单测里不必接真 res）。 */
  close?: () => void;
  outboxDao: NapcatEventOutboxDao;
  lastEventId: number;
};

/**
 * 一条 SSE 连接的订阅者：负责「缓冲实时 → 回放 outbox → flush 缓冲 → 转实时」的交接，并以
 * `lastWrittenSeq` 单调去重（同一 seq 只发一次）。attach 之后、start() 之前的实时事件进缓冲；
 * start() 回放缺口后 flush 缓冲、切实时。
 */
export class NapcatSseSubscriber implements NapcatEventSubscriber {
  private readonly write: (chunk: string) => void;
  private readonly closeConnection: () => void;
  private readonly outboxDao: NapcatEventOutboxDao;
  private phase: "buffering" | "live" = "buffering";
  private readonly buffer: NapcatOutboxEvent[] = [];
  private lastWrittenSeq: number;
  /** 连接已结束（socket close / 关停 teardown）。置位后所有写与在飞回放短路，避免写已 end 的 res。 */
  private closed = false;

  public constructor({ write, close, outboxDao, lastEventId }: NapcatSseSubscriberDeps) {
    this.write = write;
    this.closeConnection = close ?? (() => {});
    this.outboxDao = outboxDao;
    this.lastWrittenSeq = lastEventId;
  }

  public deliver(outboxEvent: NapcatOutboxEvent): void {
    if (this.closed) {
      return;
    }
    if (this.phase === "buffering") {
      this.buffer.push(outboxEvent);
      return;
    }
    this.writeIfNew(outboxEvent);
  }

  public heartbeat(): void {
    if (this.closed) {
      return;
    }
    this.write(": keepalive\n\n");
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeConnection();
  }

  /** 回放 outbox 缺口 → flush 缓冲 → 转实时。 */
  public async start(): Promise<void> {
    // 快照高水位：回放只到订阅建立瞬间的 latestSeq。此后的实时事件（seq > high）已在 add 之后
    // 经 deliver 进了 buffer，flush 时补发。没有这个上界，持续入站流量会让 listAfter 永远非空、
    // 回放追不平、buffer 无限增长（review 发现）。
    const high = await this.outboxDao.latestSeq();
    const requestedFrom = this.lastWrittenSeq;
    let cursor = requestedFrom;
    let gapChecked = false;
    // 关停 teardown 可能在回放中途 close 连接：每批前检查，已关就停手，别对 end 掉的 res 再写
    // （否则 ERR_STREAM_WRITE_AFTER_END）。writeIfNew 自身也短路，双保险。
    while (cursor < high && !this.closed) {
      const batch = await this.outboxDao.listAfter(cursor, REPLAY_BATCH_SIZE);
      if (batch.length === 0) {
        break;
      }
      // 缺口检测：agent 请求从 requestedFrom 续，但现存最早行已 > requestedFrom+1，说明中间的
      // seq 已被 prune 掉（agent 停机超保留窗口）。这会静默丢消息——至少要吼一声，别当没发生。
      if (!gapChecked) {
        gapChecked = true;
        if (requestedFrom > 0 && batch[0]!.seq > requestedFrom + 1) {
          logger.error("outbox 缺口：请求续传的 seq 已被 prune，中间消息丢失", {
            event: "napcat.events.replay_gap",
            requestedFrom,
            firstAvailableSeq: batch[0]!.seq,
            lostCount: batch[0]!.seq - requestedFrom - 1,
          });
        }
      }
      for (const event of batch) {
        if (event.seq > high) {
          break;
        }
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
    if (this.closed || outboxEvent.seq <= this.lastWrittenSeq) {
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
