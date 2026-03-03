import { AGENT_SYSTEM_PROMPT } from "./context.js";
import type { LlmMessage } from "../llm/types.js";
import { llmClient } from "../llm/client.js";
import { AGENT_TOOLS, executeToolCall } from "./tools.js";

export type RunAgentLoopInput = {
  input: string;
  maxSteps?: number;
};

export type RunAgentLoopResult = {
  output: string;
  steps: number;
};

export async function runAgentLoop({
  input,
  maxSteps = 4,
}: RunAgentLoopInput): Promise<RunAgentLoopResult> {
  const messages: LlmMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: input },
  ];

  for (let step = 1; step <= maxSteps; step += 1) {
    const completion = await llmClient.chat({
      messages,
      tools: AGENT_TOOLS,
    });
    const assistant = completion.message;

    messages.push(assistant);

    if (assistant.toolCalls && assistant.toolCalls.length > 0) {
      for (const toolCall of assistant.toolCalls) {
        const toolResult = await executeToolCall(toolCall);
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
