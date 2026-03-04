import { AGENT_SYSTEM_PROMPT } from "./context.js";
import type { LlmClient } from "../llm/client.js";
import type { LlmMessage, Tool, LlmToolCall } from "../llm/types.js";
import { AGENT_TOOLS, executeToolCall } from "./tools.js";

export type RunAgentLoopInput = {
  input: string;
  maxSteps?: number;
};

export type RunAgentLoopResult = {
  output: string;
  steps: number;
};

type ExecuteToolCall = (toolCall: LlmToolCall) => Promise<string>;

type AgentLoopOptions = {
  llmClient: LlmClient;
  tools?: Tool[];
  executeToolCall?: ExecuteToolCall;
  systemPrompt?: string;
};

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly tools: Tool[];
  private readonly executeToolCall: ExecuteToolCall;
  private readonly systemPrompt: string;

  public constructor({
    llmClient,
    tools,
    executeToolCall: executeToolCallFn,
    systemPrompt,
  }: AgentLoopOptions) {
    this.llmClient = llmClient;
    this.tools = tools ?? AGENT_TOOLS;
    this.executeToolCall = executeToolCallFn ?? executeToolCall;
    this.systemPrompt = systemPrompt ?? AGENT_SYSTEM_PROMPT;
  }

  public async run({ input, maxSteps = 4 }: RunAgentLoopInput): Promise<RunAgentLoopResult> {
    const messages: LlmMessage[] = [{ role: "user", content: input }];

    for (let step = 1; step <= maxSteps; step += 1) {
      const completion = await this.llmClient.chat({
        system: this.systemPrompt,
        messages,
        tools: this.tools,
        toolChoice: "auto",
      });
      const assistant = completion.message;

      messages.push(assistant);

      for (const toolCall of assistant.toolCalls) {
        const toolResult = await this.executeToolCall(toolCall);
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: toolResult,
        });
      }

      const output = assistant.content.trim();
      if (output.length > 0) {
        return { output, steps: step };
      }
    }

    throw new Error(`Agent loop exceeded maxSteps=${maxSteps} without final output`);
  }
}
