import { AGENT_SYSTEM_PROMPT } from "./context.js";
import type { LlmClient } from "../llm/client.js";
import type { LlmMessage, LlmTool, LlmToolCall } from "../llm/types.js";
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
  tools?: LlmTool[];
  executeToolCall?: ExecuteToolCall;
  systemPrompt?: string;
};

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly tools: LlmTool[];
  private readonly executeToolCall: ExecuteToolCall;
  private readonly systemPrompt: string;

  public constructor(options: AgentLoopOptions) {
    this.llmClient = options.llmClient;
    this.tools = options.tools ?? AGENT_TOOLS;
    this.executeToolCall = options.executeToolCall ?? executeToolCall;
    this.systemPrompt = options.systemPrompt ?? AGENT_SYSTEM_PROMPT;
  }

  public async run({ input, maxSteps = 4 }: RunAgentLoopInput): Promise<RunAgentLoopResult> {
    const messages: LlmMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: input },
    ];

    for (let step = 1; step <= maxSteps; step += 1) {
      const completion = await this.llmClient.chat({
        messages,
        tools: this.tools,
      });
      const assistant = completion.message;

      messages.push(assistant);

      if (assistant.toolCalls && assistant.toolCalls.length > 0) {
        for (const toolCall of assistant.toolCalls) {
          const toolResult = await this.executeToolCall(toolCall);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: toolResult,
          });
        }
        continue;
      }

      const output = assistant.content.trim();
      if (output.length > 0) {
        return { output, steps: step };
      }
    }

    throw new Error(`Agent loop exceeded maxSteps=${maxSteps} without final output`);
  }
}
