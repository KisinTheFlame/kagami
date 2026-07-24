// LLM 协议层的通用消息类型与 provider 标识都在 @kagami/llm（agent-runtime 也直接用它，
// 不再走 TMessage 泛型）。这里 import 后再 export，保持 server 侧既有 import 路径不变，
// 同时避开 `export ... from` 的 re-export 限制。
import type {
  JsonSchema,
  LlmContentPart,
  LlmImageContentPart,
  LlmMessage,
  LlmProviderId,
  LlmTextContentPart,
  LlmThinkingBlock,
  LlmThinkingEffort,
  LlmToolCall,
  Tool,
} from "@kagami/llm";

export type {
  JsonSchema,
  LlmContentPart,
  LlmImageContentPart,
  LlmMessage,
  LlmTextContentPart,
  LlmThinkingBlock,
  LlmThinkingEffort,
  LlmToolCall,
  Tool,
};

export type LlmToolChoice = "required" | "auto" | "none" | { tool_name: string };

export type LlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
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
  /**
   * adaptive thinking effort 档位（issue #573）。由 usage 配置在 client.chat 注入，
   * 调用方不直接传；缺省 = disabled。目前仅 claude-code provider 消费，其余忽略。
   */
  thinking?: LlmThinkingEffort;
};

export type LlmChatResponsePayload = {
  provider: LlmProviderId;
  model: string;
  message: Extract<LlmMessage, { role: "assistant" }>;
  usage?: LlmUsage;
};
