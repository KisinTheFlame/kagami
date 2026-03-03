export type LlmProviderId = "deepseek" | "openai";

export type LlmTool = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type LlmToolChoice = "auto" | "none" | { type: "function"; name: string };

export type LlmToolCall = {
  id: string;
  type: "function";
  name: string;
  arguments: string;
};

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LlmFinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "unknown";

export type LlmChatRequest = {
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  temperature?: number;
  model?: string;
  maxTokens?: number;
};

export type LlmChatResponse = {
  provider: LlmProviderId;
  model: string;
  message: Extract<LlmMessage, { role: "assistant" }>;
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
  raw?: unknown;
};
