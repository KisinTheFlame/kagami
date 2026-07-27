import { BaseTaskAgent, type TaskAgentInvoker, type ToolExecutor } from "@kagami/agent-runtime";
import type { LlmClient, LlmMessage } from "@kagami/llm-client";
import { truncateWithEllipsis } from "@kagami/kernel/utils/text";
import { createInnerVoiceInstructionMessage } from "../../../runtime/context/context-message-factory.js";
import type { AppCatalogEntryView } from "../../../runtime/root-agent/app-catalog-view.js";

/**
 * 念头文本的码点上限，纯安全网：只拦「跑题成小作文」，不替她决定说多长。
 *
 * 原值 140 的依据是「生产实测最长 92 码点」，而那 92 是在 R1 规定「2~4 个短句、每句二十来个字」
 * 时测出来的。issue #601 撤掉全部形式约束（怎么说、说多长由她自己定）后，140 会从安全网变成隐形
 * 的塑形器——超了就无省略号硬切，半句话进她的上下文。故放宽到 300。
 *
 * 按码点截断绝不劈 UTF-16 代理对（教训见 issue #187）。
 */
const MAX_THOUGHT_CODE_POINTS = 300;

export type InnerVoiceTaskInput = {
  /** 小镜的真实 system prompt（人格底座），与主 Agent 同一份。 */
  systemPrompt: string;
  /** 主 Agent 完整消息历史（调用方已隔离，本 agent 只读）。 */
  messages: LlmMessage[];
  /** App 名单，与 system prompt 共用同一份 view-model 与顺序（issue #596）。 */
  apps?: ReadonlyArray<AppCatalogEntryView>;
  /** 最近几条已注入的念头，供 R1 展示惯性、要求这次产出不同（issue #596）。 */
  recentThoughts?: readonly string[];
};

/**
 * 内心独白 task agent（issue #265 / #410）。
 *
 * 输入：主 Agent system prompt + 完整消息历史。
 * 输出：她此刻要去动的那几样，单串；形状（几句、多长、怎么断）由她自己定，R1 不再规定
 * （issue #601）。空字符串仍被接受为「这次没念头」、调用方不注入，但指令层已不再提供这条退路。
 * 「为何不用数组」见 emit-inner-thought.tool.ts。
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
      // 正常一轮就该 emit；留余量给纯文本轮（toolChoice auto 下模型可能先自言自语）。
      // 6 而非 4：生产实测过「参数被拒 → 连发空轮 → 跑满轮次判 failed」这条放大路径，
      // 配合 formatInvalidArguments 给出可操作提示一起做纵深防御（issue #596）。
      maxRounds: 6,
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
      messages: [
        ...input.messages,
        createInnerVoiceInstructionMessage({
          ...(input.apps ? { apps: input.apps } : {}),
          ...(input.recentThoughts ? { recentThoughts: input.recentThoughts } : {}),
        }),
      ],
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
    // 空字符串代表「没念头」，由 InnerVoiceExtension 判为 empty、不注入。
    return truncateWithEllipsis(content.trim(), MAX_THOUGHT_CODE_POINTS, "");
  }
}
