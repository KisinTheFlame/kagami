import { AgentContextManager } from "./context-manager.js";
import type { LlmClient } from "../llm/client.js";
import { AGENT_TOOLS, executeToolCall } from "./tools.js";

export type RunAgentLoopResult = {
  output: string;
  steps: number;
};

type AgentLoopDeps = {
  llmClient: LlmClient;
  contextManager: AgentContextManager;
};

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly contextManager: AgentContextManager;

  public constructor({ llmClient, contextManager }: AgentLoopDeps) {
    this.llmClient = llmClient;
    this.contextManager = contextManager;
  }

  public async run(): Promise<RunAgentLoopResult> {
    while (true) {
      const completion = await this.llmClient.chat({
        system: this.contextManager.getSystemPrompt(),
        messages: this.contextManager.getMessages(),
        tools: AGENT_TOOLS, // TODO: tool manager
        toolChoice: "auto",
      });
      const assistant = completion.message;
      const output = this.contextManager.pushAssistantMessage(assistant);

      for (const toolCall of assistant.toolCalls) {
        const toolResult = await executeToolCall(toolCall);
        this.contextManager.pushToolMessage(toolCall.id, toolResult);
      }

      if (output !== null) {
        return { output, steps: this.contextManager.getSteps() };
      }
    }
  }
}
