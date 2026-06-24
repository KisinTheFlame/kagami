import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import {
  REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
  type Operation,
  type ReplaceLeadingMessagesEffect,
  type ToolExecutor,
} from "@kagami/agent-runtime";
import { createConversationSummaryMessage } from "../../../runtime/context/context-message-factory.js";
import { SUMMARY_TOOL_NAME } from "../tools/summary.tool.js";

export type ContextSummaryInput = {
  systemPrompt: string;
  /** 喂给 LLM 做摘要的消息（被压缩的那一段，即 context 的前缀）。 */
  messages: LlmMessage[];
  tools: Tool[];
};

/**
 * 上下文压缩 Operation。自己产 `replace_leading_messages` Effect——"压缩这件事的
 * 副作用"由 Operation 自描述，调用方只是把 effects 交给 Interpreter，不再手动拼装。
 *
 * 跟 Tool 的对称：Tool 返 `{ content, effects }` 让调用方翻译，Operation 返
 * `{ effects }` 同理。Effect 的生产端在这里收口。
 *
 * Operation 只需要知道"要摘要哪段"（input.messages），不需要知道"保留哪些"——
 * 前缀替换语义里保留段就是 count 之后的部分。count = 被摘要的前缀长度，Operation
 * 从 input.messages.length 自己算。
 *
 * 产公共的 `ReplaceLeadingMessagesEffect<LlmMessage>`（来自 agent-runtime），不依赖
 * 任何具体 Agent 的 Effect 联合——RootAgent / StoryAgent 都能用同一个 Operation。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export type ContextSummaryResult = {
  /** 空数组表示 LLM 没产出有效摘要，调用方不做任何变更。 */
  effects: readonly ReplaceLeadingMessagesEffect[];
};

export class ContextSummaryOperation implements Operation<
  ContextSummaryInput,
  ContextSummaryResult
> {
  private readonly llmClient: LlmClient;
  private readonly summaryToolExecutor: ToolExecutor;
  private readonly reminderMessageFactory: () => Extract<LlmMessage, { role: "user" }>;

  public constructor({
    llmClient,
    summaryToolExecutor,
    reminderMessageFactory,
  }: {
    llmClient: LlmClient;
    summaryToolExecutor: ToolExecutor;
    reminderMessageFactory: () => Extract<LlmMessage, { role: "user" }>;
  }) {
    this.llmClient = llmClient;
    this.summaryToolExecutor = summaryToolExecutor;
    this.reminderMessageFactory = reminderMessageFactory;
  }

  public async execute(input: ContextSummaryInput): Promise<ContextSummaryResult> {
    const summary = await this.summarize(input);
    if (!summary) {
      return { effects: [] };
    }

    return {
      effects: [
        {
          type: REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
          // 把被摘要的前缀（input.messages 那 N 条）替换成单条 summary。
          count: input.messages.length,
          replacement: [createConversationSummaryMessage(summary)],
        },
      ],
    };
  }

  private async summarize(input: ContextSummaryInput): Promise<string | null> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.messages, this.reminderMessageFactory()],
        tools: input.tools,
        toolChoice: { tool_name: SUMMARY_TOOL_NAME },
      },
      {
        usage: "contextSummarizer",
      },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== SUMMARY_TOOL_NAME) {
      return null;
    }

    const executionResult = await this.summaryToolExecutor.execute(
      toolCall.name,
      toolCall.arguments,
      {},
    );
    const summary = executionResult.content.trim();

    return summary.length > 0 ? summary : null;
  }
}
