import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createBackpressureAwareWrite } from "@kagami/http/sse";
import { SCHEDULER_TICKS_SSE_PATH } from "@kagami/scheduler-api/event";
import type { SchedulerEngine } from "../application/scheduler-engine.js";
import type { TickBroadcaster, TickSubscriber } from "../application/tick-broadcaster.js";

const logger = new AppLogger({ source: "scheduler.ticks-handler" });

/** SSE 背压宽限期：res.write 背压后等 drain 这么久，还不 drain 就销毁连接（复刻 napcat #425）。 */
const SSE_BACKPRESSURE_GRACE_MS = 15_000;

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

      // 背压保护（复刻 napcat #425）：慢/半死消费方（agent 事件循环卡住）若不 drain，裸 res.write
      // 续写会让 scheduler 进程内存无界增长——tick 帧虽小，但同进程内所有 owner 共享一个进程。背压即
      // 停写、宽限期后 destroy，让对端重连（重连重新注册 + flush pending，tick 是派生事实不做回放）。
      const write = createBackpressureAwareWrite(res, SSE_BACKPRESSURE_GRACE_MS, () => {
        logger.warn("SSE 背压超时，销毁连接等使用方重连", {
          event: "scheduler.sse.backpressure_timeout",
          ownerId,
        });
      });

      const subscriber: TickSubscriber = {
        write,
        heartbeat: () => write(": keepalive\n\n"),
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
