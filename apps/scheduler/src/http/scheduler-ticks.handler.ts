import type { FastifyInstance, FastifyRequest } from "fastify";
import { SCHEDULER_TICKS_SSE_PATH } from "@kagami/scheduler-api/event";
import type { SchedulerEngine } from "../application/scheduler-engine.js";
import type { TickBroadcaster, TickSubscriber } from "../application/tick-broadcaster.js";

type SchedulerTicksHandlerDeps = {
  broadcaster: TickBroadcaster;
  engine: SchedulerEngine;
};

/**
 * SSE tick 流端点 `GET /scheduler/ticks?ownerId=<id>`（issue #428）：使用方拨出订阅，调度器在这条
 * 长连接上推该 owner 名下任务的 tick。裸 ServerResponse（reply.hijack）承载 text/event-stream。
 *
 * 连接建立即先 add 订阅者（此刻起 live tick 直接投递），再 flushPending 把断连期间按 misfire 缓存
 * 的 tick 冲一次。无 Last-Event-ID / 无回放——tick 是派生事实，断连补偿是 pending 合并，不是回放。
 */
export class SchedulerTicksHandler {
  private readonly broadcaster: TickBroadcaster;
  private readonly engine: SchedulerEngine;

  public constructor({ broadcaster, engine }: SchedulerTicksHandlerDeps) {
    this.broadcaster = broadcaster;
    this.engine = engine;
  }

  public register(app: FastifyInstance): void {
    app.get(SCHEDULER_TICKS_SSE_PATH, async (request, reply) => {
      const ownerId = parseOwnerId(request);
      if (ownerId === undefined) {
        await reply.code(400).send({ error: "ownerId query parameter is required" });
        return;
      }

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const subscriber: TickSubscriber = {
        write: chunk => res.write(chunk),
        heartbeat: () => res.write(": keepalive\n\n"),
      };

      // 先 add：此刻起 live tick 直接投递（不再进 pending）；再 flush 断连期间缓存的 pending。
      this.broadcaster.add(ownerId, subscriber);
      res.on("close", () => this.broadcaster.remove(ownerId, subscriber));
      this.engine.flushPending(ownerId);
    });
  }
}

function parseOwnerId(request: FastifyRequest): string | undefined {
  const raw = (request.query as Record<string, unknown> | undefined)?.ownerId;
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  return undefined;
}
