import { createWebSearchReminderMessage } from "../../../context/context-message-factory.js";
import type { LlmClient } from "../../../llm/client.js";
import type { LlmMessage } from "../../../llm/types.js";
import type { ToolExecutor } from "../../../tools/index.js";

export type WebSearchAgentInput = {
  question: string;
  systemPrompt: string;
  contextMessages: LlmMessage[];
};

export class WebSearchAgent {
  private readonly llmClient: LlmClient;
  private readonly searchTools: ToolExecutor;

  public constructor({
    llmClient,
    searchTools,
  }: {
    llmClient: LlmClient;
    searchTools: ToolExecutor;
  }) {
    this.llmClient = llmClient;
    this.searchTools = searchTools;
  }

  public async search(input: WebSearchAgentInput): Promise<string> {
    const question = input.question.trim();
    if (question.length === 0) {
      throw new Error("WebSearchAgent.search requires a non-empty question");
    }
    const systemPrompt = input.systemPrompt.trim();
    if (systemPrompt.length === 0) {
      throw new Error("WebSearchAgent.search requires a non-empty systemPrompt");
    }

    const messages: LlmMessage[] = [
      ...input.contextMessages,
      createWebSearchReminderMessage(question),
    ];

    while (true) {
      const response = await this.llmClient.chat(
        {
          system: systemPrompt,
          messages: [...messages],
          tools: this.searchTools.definitions(),
          toolChoice: "required",
        },
        {
          usage: "webSearchAgent",
        },
      );

      messages.push(response.message);

      for (const toolCall of response.message.toolCalls) {
        const executionResult = await this.searchTools.execute(
          toolCall.name,
          toolCall.arguments,
          {},
        );

        if (executionResult.content.length > 0) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: executionResult.content,
          });
        }

        if (executionResult.signal === "finish_round") {
          const summary = executionResult.content.trim();
          if (summary.length === 0) {
            break;
          }

          return summary;
        }
      }
    }
  }
}
