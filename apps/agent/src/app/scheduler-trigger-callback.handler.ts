import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import {
  schedulerTriggerCallbackContract,
  type SchedulerTriggerCallbackResponse,
} from "@kagami/scheduler-api/trigger";
import type { SchedulerClient } from "@kagami/scheduler-client/scheduler-client";

type SchedulerTriggerCallbackHandlerDeps = {
  schedulerClient: SchedulerClient;
};

/**
 * 统一触发的反向回调端点（scheduler B P3，issue #493）。scheduler 收到前端手动触发后反向 POST
 * 到本进程的 `/internal/scheduler-trigger`，这里收 taskName → 调 SDK triggerNowDetached 同步受理 +
 * 后台跑 handler → 把受理结果映射成回调判别联合回给 scheduler（它再原样透传回前端）：
 *
 * - `{ ok: true }` → `{ outcome: "accepted" }`
 * - `{ ok: false, reason }` → `{ outcome: "rejected", reason }`（unknown_task / overlap）
 *
 * 用 **detached** 触发（非 triggerNow）：callback 契约 5s 硬超时，必须**立即**回受理、handler 后台跑，
 * 否则长任务（data-retention 分块删）会被 scheduler 误判 owner_unreachable。owner 侧从不产生
 * owner_unreachable——那是 scheduler 对 callback 失败的归一。前端旧路径（agent-api
 * triggerSchedulerTask，仍用阻塞式 triggerNow）并存到 P5 才拆。
 */
export class SchedulerTriggerCallbackHandler {
  private readonly schedulerClient: SchedulerClient;

  public constructor({ schedulerClient }: SchedulerTriggerCallbackHandlerDeps) {
    this.schedulerClient = schedulerClient;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(
      app,
      schedulerTriggerCallbackContract.triggerCallback,
      ({ input }): SchedulerTriggerCallbackResponse => {
        // detached：同步返回受理结果（accepted / unknown_task / overlap），handler 后台跑。绝不能
        // await 满整个 handler——callback 契约 5s 硬超时，长任务（data-retention）会被误判 unreachable。
        const result = this.schedulerClient.triggerNowDetached(input.taskName);
        if (result.ok) {
          return { outcome: "accepted" };
        }
        return { outcome: "rejected", reason: result.reason };
      },
    );
  }
}
