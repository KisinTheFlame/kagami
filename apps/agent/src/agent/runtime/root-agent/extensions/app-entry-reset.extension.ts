import type { LoopAgentExtension } from "@kagami/agent-runtime";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

/**
 * 上下文压缩时清空 session 的「已进入 App」集合，让压缩后首进某 App 重新自动吐一次 help。
 *
 * 语义与 StoryRecallExtension.onContextCompacted 同构：压缩会把前半段历史摘要掉，早先注入的
 * help 大概率被丢弃，故 entered-set 归零、把「一桶上下文」的边界对齐到压缩边界。注意压缩会保留
 * 最近 ~10% 消息，若某 App 的 <app_help> 恰落在保留尾部，则下次进它会重复追加一次——这是可接受
 * 的有界重复（每 App 每次压缩至多一次），换取实现简单、不把本扩展耦合进压缩的保留/摘要边界细节。
 *
 * session 不是 loop extension，收不到 notifyContextCompacted 广播；本扩展作为薄壳把这条
 * 通知转达给 session。
 */
export class AppEntryResetExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly session: Pick<RootAgentSessionController, "clearEnteredApps">;

  public constructor({
    session,
  }: {
    session: Pick<RootAgentSessionController, "clearEnteredApps">;
  }) {
    this.session = session;
  }

  public onContextCompacted(): void {
    this.session.clearEnteredApps();
  }
}
