import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { napcatApiContract } from "@kagami/napcat-api/contract";
import type { AlertChannel } from "../domain/alert-channel.js";

/**
 * QQ 群投递通道：经 kagami-napcat 的 `sendGroupMessage` 把告警发进专用告警群。
 *
 * 已知单点（v1 有意不解决）：告警链路是 observatory → napcat → QQ。**napcat 挂掉时告警发不
 * 出去，而 napcat 挂掉正是最需要告警的时刻。** 兜底只有两层日志（上报方本地 + observatory
 * 自己）。第二投递通道属于「长成可观测性平台」那一步。
 *
 * `createClient` 在不可达 / 非 2xx / 坏响应时抛错，正是 `AlertChannel` 契约要的「失败必须抛」。
 */
export class NapcatAlertChannel implements AlertChannel {
  private readonly api: JsonClient<typeof napcatApiContract>;
  private readonly groupId: string;

  public constructor({
    baseUrl,
    groupId,
    fetch: fetchImpl,
  }: {
    baseUrl: string;
    groupId: string;
    fetch?: typeof fetch;
  }) {
    this.api = createClient(napcatApiContract, {
      baseUrl,
      unreachableMessage: "kagami-napcat 不可达，告警投递失败",
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    this.groupId = groupId;
  }

  public async deliver(message: string): Promise<void> {
    await this.api.sendGroupMessage({ groupId: this.groupId, message });
  }
}
