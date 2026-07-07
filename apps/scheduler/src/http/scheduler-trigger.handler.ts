import type { FastifyInstance } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { registerJsonRoute } from "@kagami/http/register";
import { createClient } from "@kagami/rpc-client/client";
import {
  schedulerTriggerContract,
  schedulerTriggerCallbackContract,
  type SchedulerTriggerResponse,
} from "@kagami/scheduler-api/trigger";
import type { SchedulerEngine } from "../application/scheduler-engine.js";

const logger = new AppLogger({ source: "scheduler.trigger" });

type FetchLike = typeof fetch;

type SchedulerTriggerHandlerDeps = {
  engine: SchedulerEngine;
  /** 反向 callback 用的 fetch（测试可注入 mock）。缺省全局 fetch。 */
  fetch?: FetchLike;
};

/**
 * 统一触发入口路由（scheduler B P3，issue #493）。前端 → scheduler 的手动触发：
 *
 * 1. 查 engine.getCallbackBaseUrl(ownerId)。null（owner 未注册/未连）→ 直接回 owner_unreachable。
 * 2. 有 → 现构造一个指向该 callbackBaseUrl 的 client，反向 POST 回 owner 的 triggerCallback 端点
 *    （contract.timeoutMs=5s、不重试）。owner 本地受理并后台跑 handler（SDK triggerNowDetached），回 accepted / rejected。
 * 3. callback 成功 → 把 owner 的判别联合原样透传（两者 accepted/rejected 形状相同）。
 * 4. callback 连不上/超时/非 2xx/响应无效 → createClient 兜底抛错，这里 catch 后归一为 owner_unreachable。
 *
 * baseUrl 每 owner 不同（且可能重启换端口）：createClient 只支持构造期 baseUrl，故每次触发现 new 一个
 * 指向当前 callbackBaseUrl 的 client；client 无状态、构造极廉价。5s 超时由契约 timeoutMs 承载
 * （rpc-client 走 AbortSignal.timeout）。前端此阶段还不切（P4 才切），本 P3 只把这条链路建好。
 */
export class SchedulerTriggerHandler {
  private readonly engine: SchedulerEngine;
  private readonly fetchImpl: FetchLike | undefined;

  public constructor({ engine, fetch: fetchImpl }: SchedulerTriggerHandlerDeps) {
    this.engine = engine;
    this.fetchImpl = fetchImpl;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(
      app,
      schedulerTriggerContract.triggerTask,
      async ({ params }): Promise<SchedulerTriggerResponse> => {
        const { ownerId, taskName } = params;
        const callbackBaseUrl = this.engine.getCallbackBaseUrl(ownerId);
        if (callbackBaseUrl === null) {
          return { outcome: "owner_unreachable" };
        }
        const callback = createClient(schedulerTriggerCallbackContract, {
          baseUrl: callbackBaseUrl,
          ...(this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl }),
        });
        try {
          // owner 的判别联合（accepted / rejected）与触发入口前两支同形，直接透传。
          return await callback.triggerCallback({ taskName });
        } catch (error) {
          // 连不上/超时/非 2xx/坏响应：createClient 已把三种成因归一成抛出的 Error，这里统一
          // 归一为 owner_unreachable（owner 侧从不产生这个 outcome）。
          logger.warn("scheduler trigger callback failed, treated as owner_unreachable", {
            event: "scheduler.trigger.callback_failed",
            ownerId,
            taskName,
            error: error instanceof Error ? error.message : String(error),
          });
          return { outcome: "owner_unreachable" };
        }
      },
    );
  }
}
