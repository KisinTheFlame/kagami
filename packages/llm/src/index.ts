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

/** 工具参数的 JSON Schema（仅支持 object 顶层）。 */
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  additionalProperties?: boolean | Record<string, unknown>;
};

/**
 * 一个工具对 LLM 的定义（name / description / parameters）。这是 LLM 协议层的
 * "工具定义"——Agent Runtime 的 kernel 把它塞进 chat 请求的 tools 字段，LLM
 * 据此决定调哪个工具。不含执行逻辑（执行是 agent-runtime 的 ToolComponent）。
 */
export type Tool = {
  name: string;
  description?: string;
  parameters: JsonSchema;
};
