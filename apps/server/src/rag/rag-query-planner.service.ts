import { createUserMessage } from "../context/context-message-factory.js";
import type { LlmClient } from "../llm/client.js";
import type { LlmMessage } from "../llm/types.js";
import type { ToolExecutor } from "../tools/index.js";
import { SEARCH_MEMORY_TOOL_NAME } from "../tools/index.js";

export class RagQueryPlannerService {
  private readonly llmClient: LlmClient;
  private readonly plannerTools: ToolExecutor;
  private readonly systemPromptFactory: () => Promise<string> | string;

  public constructor({
    llmClient,
    plannerTools,
    systemPromptFactory,
  }: {
    llmClient: LlmClient;
    plannerTools: ToolExecutor;
    systemPromptFactory: () => Promise<string> | string;
  }) {
    this.llmClient = llmClient;
    this.plannerTools = plannerTools;
    this.systemPromptFactory = systemPromptFactory;
  }

  public async plan(input: {
    groupId: string;
    contextMessages: LlmMessage[];
  }): Promise<LlmMessage[]> {
    const firstResponse = await this.llmClient.chat(
      {
        system: await this.systemPromptFactory(),
        messages: input.contextMessages,
        tools: this.plannerTools.definitions(),
        toolChoice: { tool_name: SEARCH_MEMORY_TOOL_NAME },
      },
      {
        usage: "ragQueryPlanner",
      },
    );

    const toolCall = firstResponse.message.toolCalls[0];
    if (!toolCall || toolCall.name !== SEARCH_MEMORY_TOOL_NAME) {
      return [];
    }

    const executionResult = await this.plannerTools.execute(toolCall.name, toolCall.arguments, {
      groupId: input.groupId,
    });
    const searchResult = executionResult.content.trim();

    return searchResult.length > 0 ? [createUserMessage(searchResult)] : [];
  }
}
