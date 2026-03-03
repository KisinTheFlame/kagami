import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { AGENT_SYSTEM_PROMPT } from "./context.js";
import { createChatCompletion } from "../llm/deepseek-chat-adapter.js";
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
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: input },
  ];

  for (let step = 1; step <= maxSteps; step += 1) {
    const assistant = await createChatCompletion({
      messages,
      tools: AGENT_TOOLS,
    });

    messages.push(toAssistantMessageParam(assistant.content, assistant.tool_calls));

    if (assistant.tool_calls && assistant.tool_calls.length > 0) {
      for (const toolCall of assistant.tool_calls) {
        const toolResult = await executeToolCall(toolCall);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
      continue;
    }

    const output = extractText(assistant.content);
    if (output.length > 0) {
      return { output, steps: step };
    }
  }

  throw new Error(`Agent loop exceeded maxSteps=${maxSteps} without final output`);
}

function toAssistantMessageParam(
  content: string | Array<ChatCompletionContentPartText> | null,
  toolCalls?: ChatCompletionMessageToolCall[],
): ChatCompletionAssistantMessageParam {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls,
  };
}

function extractText(content: string | Array<ChatCompletionContentPartText> | null): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }

  return "";
}
