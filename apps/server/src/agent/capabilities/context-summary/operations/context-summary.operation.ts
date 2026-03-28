import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import type { Operation, ToolExecutor } from "@kagami/agent-runtime";
import { createContextSummarizerSystemPrompt } from "./system-prompt.js";
import { SUMMARY_TOOL_NAME } from "../tools/summary.tool.js";

export type ContextSummaryInput = {
  messages: LlmMessage[];
  tools: Tool[];
};

export interface ContextSummaryPlanner {
  summarize(input: ContextSummaryInput): Promise<string | null>;
}

export class ContextSummaryOperation
  implements Operation<ContextSummaryInput, string | null>, ContextSummaryPlanner
{
  private readonly llmClient: LlmClient;
  private readonly summaryToolExecutor: ToolExecutor;

  public constructor({
    llmClient,
    summaryToolExecutor,
  }: {
    llmClient: LlmClient;
    summaryToolExecutor: ToolExecutor;
  }) {
    this.llmClient = llmClient;
    this.summaryToolExecutor = summaryToolExecutor;
  }

  public async execute(input: ContextSummaryInput): Promise<string | null> {
    const response = await this.llmClient.chat(
      {
        system: createContextSummarizerSystemPrompt(),
        messages: input.messages,
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

  public async summarize(input: ContextSummaryInput): Promise<string | null> {
    return await this.execute(input);
  }
}
