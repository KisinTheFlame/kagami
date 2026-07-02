import type { LlmClient, LlmMessage, Tool } from "@kagami/llm-client";
import type { ToolExecutor } from "@kagami/agent-runtime";
import { truncateWithEllipsis } from "@kagami/shared/utils";
import { EMIT_INNER_THOUGHT_TOOL_NAME } from "../tools/emit-inner-thought.tool.js";

/** 念头文本的码点上限：超长通常意味着跑题成小作文，按码点截断绝不劈 UTF-16 代理对。 */
const MAX_THOUGHT_CODE_POINTS = 120;

export type InnerVoiceInput = {
  /** 小镜的真实 system prompt（人格底座），与主 Agent 同一份。 */
  systemPrompt: string;
  /** 主上下文尾部的平衡切片（最近真实经历素材）。 */
  messages: LlmMessage[];
};

export type InnerVoiceResult = {
  /** null = 此刻没什么真想做的（LLM 提交了空 thought 或没按约提交），调用方不注入。 */
  thought: string | null;
};

/**
 * 内心独白生成器（issue #265）：一次隔离的 forced-tool LLM 调用，以小镜口吻产出一个
 * 锚定近期真实经历、指向一步可达可供性的第一人称念头。toolChoice 强制指到
 * emit_inner_thought，空 thought 即「没念头」。
 *
 * 与 SummaryTaskAgent 不同，这里是单轮一次性调用（不是多轮 ReAct 循环），故不走
 * TaskAgent；用自己的一元工具集，与主 Agent 前缀完全隔离——大量素材（尾部切片）只进
 * 这次调用，主 Agent 前缀零污染；产出至多一句话经 InnerThoughtEvent 回流。
 */
export class InnerVoiceOperation {
  private readonly llmClient: LlmClient;
  private readonly emitToolExecutor: ToolExecutor;
  private readonly emitToolDefinitions: Tool[];
  private readonly instructionMessageFactory: () => Extract<LlmMessage, { role: "user" }>;

  public constructor({
    llmClient,
    emitToolExecutor,
    instructionMessageFactory,
  }: {
    llmClient: LlmClient;
    emitToolExecutor: ToolExecutor;
    instructionMessageFactory: () => Extract<LlmMessage, { role: "user" }>;
  }) {
    this.llmClient = llmClient;
    this.emitToolExecutor = emitToolExecutor;
    this.emitToolDefinitions = emitToolExecutor.definitions();
    this.instructionMessageFactory = instructionMessageFactory;
  }

  public async execute(input: InnerVoiceInput): Promise<InnerVoiceResult> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.messages, this.instructionMessageFactory()],
        tools: this.emitToolDefinitions,
        toolChoice: { tool_name: EMIT_INNER_THOUGHT_TOOL_NAME },
      },
      {
        usage: "innerVoice",
      },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== EMIT_INNER_THOUGHT_TOOL_NAME) {
      return { thought: null };
    }

    const executionResult = await this.emitToolExecutor.execute(
      toolCall.name,
      toolCall.arguments,
      {},
    );
    // 复用 @kagami/shared 的码点截断：它先剥落单代理项再按码点切，绝不产出 lone
    // surrogate（教训见 issue #187）。ellipsis 传 "" —— 念头是自言自语，截断不加省略号。
    const thought = truncateWithEllipsis(
      executionResult.content.trim(),
      MAX_THOUGHT_CODE_POINTS,
      "",
    );

    return { thought: thought.length > 0 ? thought : null };
  }
}
