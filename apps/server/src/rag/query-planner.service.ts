import { createAgentSystemPrompt } from "../agent/context.js";
import type { LlmClient } from "../llm/client.js";
import type { LlmMessage } from "../llm/types.js";
import type { ToolSet } from "../tools/index.js";
import { SEARCH_MEMORY_TOOL_NAME } from "../tools/index.js";

export class RagQueryPlannerService {
  private readonly llmClient: LlmClient;
  private readonly plannerTools: ToolSet;
  private readonly systemPrompt: string | (() => Promise<string> | string);

  public constructor({
    llmClient,
    plannerTools,
    systemPrompt,
    systemPromptFactory,
  }: {
    llmClient: LlmClient;
    plannerTools: ToolSet;
    systemPrompt?: string;
    systemPromptFactory?: () => Promise<string> | string;
  }) {
    this.llmClient = llmClient;
    this.plannerTools = plannerTools;
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
      });
  }

  public async plan(input: {
    groupId: string;
    currentMessage: string;
    contextMessages: LlmMessage[];
  }): Promise<string | null> {
    const lastContextMessage = input.contextMessages.at(-1);
    const hasCurrentMessageAtTail =
      lastContextMessage?.role === "user" && lastContextMessage.content === input.currentMessage;
    const baseMessages: LlmMessage[] = hasCurrentMessageAtTail
      ? input.contextMessages
      : [
          ...input.contextMessages,
          {
            role: "user",
            content: input.currentMessage,
          },
        ];

    const firstResponse = await this.llmClient.chat(
      {
        system: await this.getSystemPrompt(),
        messages: baseMessages,
        tools: this.plannerTools.definitions(),
        toolChoice: { tool_name: SEARCH_MEMORY_TOOL_NAME },
      },
      {
        usage: "ragQueryPlanner",
      },
    );

    const toolCall = firstResponse.message.toolCalls[0];
    if (!toolCall || toolCall.name !== SEARCH_MEMORY_TOOL_NAME) {
      return null;
    }

    const executionResult = await this.plannerTools.execute(toolCall.name, toolCall.arguments, {
      groupId: input.groupId,
    });
    const searchResult = executionResult.content;

    return searchResult.length > 0 ? searchResult : null;
  }

  private async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

    return this.systemPrompt;
  }
}
