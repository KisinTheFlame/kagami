import { BaseTaskAgent, type TaskAgentInvoker, type ToolExecutor } from "@kagami/agent-runtime";
import type { LlmClient, LlmMessage } from "@kagami/llm-client";
import { truncateWithEllipsis } from "@kagami/kernel/utils/text";
import { createInnerVoiceInstructionMessage } from "../../../runtime/context/context-message-factory.js";

/** 念头文本的码点上限：超长通常意味着跑题成小作文，按码点截断绝不劈 UTF-16 代理对。 */
const MAX_THOUGHT_CODE_POINTS = 120;

export type InnerVoiceTaskInput = {
  /** 小镜的真实 system prompt（人格底座），与主 Agent 同一份。 */
  systemPrompt: string;
  /** 主 Agent 完整消息历史（调用方已隔离，本 agent 只读）。 */
  messages: LlmMessage[];
};

/**
 * 内心独白 task agent（issue #265 / #410）。
 *
 * 输入：主 Agent system prompt + 完整消息历史。
 * 输出：至多一句的第一人称念头；空字符串 = 此刻没什么真想做的（调用方不注入）。
 *
 * 关键设计：与 SummaryTaskAgent / TodoSuggestionTaskAgent 同构——复用主 Agent 的
 * tools / system / 消息前缀（字节相等），命中 Anthropic prompt cache。隔离手段是
 * 顶层工具集中除 invoke 之外全部走 OutOfScopeTool 软拒绝，invoke 只挂
 * emit_inner_thought 终止子工具。本 agent 不持有 AgentContext 句柄，类型上就无法
 * 改动主上下文。
 *
 * 终止条件：LLM 调用 invoke({tool:"emit_inner_thought", thought:...})，产
 * `terminate` Effect 退出循环；跑满 maxRounds 仍未终止则抛
 * TaskAgentMaxRoundsExceededError，由 InnerVoiceExtension 降级为一次 failed。
 */
export class InnerVoiceTaskAgent
  extends BaseTaskAgent<InnerVoiceTaskInput, string, "agent">
  implements TaskAgentInvoker<InnerVoiceTaskInput, string>
{
  public constructor({ llmClient, taskTools }: { llmClient: LlmClient; taskTools: ToolExecutor }) {
    super({
      model: llmClient,
      taskTools,
      // 正常一轮就该 emit；留几轮余量给纯文本轮（toolChoice auto 下模型可能先自言自语）。
      maxRounds: 4,
    });
  }

  protected async createInvocation(input: InnerVoiceTaskInput): Promise<{
    systemPrompt: string;
    messages: LlmMessage[];
    usage: "agent";
    scene: string;
  }> {
    const systemPrompt = input.systemPrompt.trim();
    if (systemPrompt.length === 0) {
      throw new Error("InnerVoiceTaskAgent requires a non-empty systemPrompt");
    }

    return {
      systemPrompt,
      messages: [...input.messages, createInnerVoiceInstructionMessage()],
      // usage=agent：复用主 Agent 前缀命中 prompt cache。scene 保留原归因标签。
      usage: "agent",
      scene: "innerVoice",
    };
  }

  protected buildResult({
    content,
  }: {
    input: InnerVoiceTaskInput;
    messages: LlmMessage[];
    content: string;
  }): string {
    // 复用 kernel 的码点截断：先剥落单代理项再按码点切，绝不产出 lone surrogate
    // （教训见 issue #187）。ellipsis 传 "" —— 念头是自言自语，截断不加省略号。
    // 空字符串代表「没念头」，直接返回，由 InnerVoiceExtension 判为 empty、不注入。
    return truncateWithEllipsis(content.trim(), MAX_THOUGHT_CODE_POINTS, "");
  }
}
