/**
 * LLM 协议层的消息表示。OpenAI 风格的 user / assistant / tool 三态，完全通用，
 * 不含任何具体 provider 或项目（Kagami / napcat）语义。
 *
 * 这是 Agent Runtime 与 LLM 之间流动的基本单元——`@kagami/agent-runtime` 的
 * ReAct kernel、Tool、Effect 等都直接用它，不再用 `TMessage` 泛型抽象。
 */

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
