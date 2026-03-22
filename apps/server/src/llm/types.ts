export type LlmProviderId = "deepseek" | "openai" | "openai-codex" | "claude-code";
export type LlmUsageId =
  | "agent"
  | "ragQueryPlanner"
  | "contextSummarizer"
  | "vision"
  | "replyThought"
  | "replyReview"
  | "replyWriter";

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

export type LlmTextContentPart = {
  type: "text";
  text: string;
};

export type LlmImageContentPart = {
  type: "image";
  content: Buffer;
  mimeType: string;
  filename?: string;
};

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart;

export type LlmMessage =
  | { role: "user"; content: string | LlmContentPart[] }
  | { role: "assistant"; content: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LlmImageInput = {
  content: Buffer;
  mimeType: string;
  filename?: string;
};

export type LlmChatRequest = {
  system?: string;
  messages: LlmMessage[];
  tools: Tool[];
  toolChoice: LlmToolChoice;
  model?: string;
};

export type LlmChatResponsePayload = {
  provider: LlmProviderId;
  model: string;
  message: Extract<LlmMessage, { role: "assistant" }>;
  usage?: LlmUsage;
};
