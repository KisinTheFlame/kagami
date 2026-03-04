import type { z } from "zod";

export type LlmProviderId = "deepseek" | "openai";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
};

export type Tool = {
  name: string;
  description?: string;
  parameters: JsonSchema;
};

export type LlmToolChoice = "required" | "auto" | "none" | { tool_name: string };

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LlmChatRequest = {
  system?: string;
  messages: LlmMessage[];
  tools: Tool[];
  toolChoice: LlmToolChoice;
  model?: string;
};

export type LlmChatResponse = {
  provider: LlmProviderId;
  model: string;
  message: Extract<LlmMessage, { role: "assistant" }>;
  usage?: LlmUsage;

  text(): string;
  json<S extends z.ZodTypeAny>(schema: S): z.infer<S>;
  toolCalls(): LlmToolCall[];
};
