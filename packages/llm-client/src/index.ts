import {
  createLlmClient,
  type LlmClient,
  type LlmChatOptions,
  type LlmChatDirectOptions,
  type LlmListAvailableProvidersOptions,
  type LlmChatDirectResult,
  type LlmChatCallObservation,
  type LlmChatCallSuccessObservation,
  type LlmChatCallErrorObservation,
} from "./client.js";
import {
  attachLlmProviderFailureContext,
  getLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  type LlmProvider,
  type LlmProviderChatResult,
  type LlmProviderFailureContext,
} from "./provider.js";
import type { LlmProviderId } from "@kagami/llm";
import type {
  JsonSchema,
  LlmContentPart,
  LlmImageContentPart,
  LlmMessage,
  LlmTextContentPart,
  LlmToolCall,
  Tool,
  LlmToolChoice,
  LlmUsage,
  LlmImageInput,
  LlmChatRequest,
  LlmChatResponsePayload,
} from "./types.js";
import { createDeepSeekProvider } from "./providers/deepseek-provider.js";
import { createOpenAiProvider } from "./providers/openai-provider.js";
import { createOpenAiCodexProvider } from "./providers/openai-codex-provider.js";
import {
  createClaudeCodeProvider,
  createClaudeCodeAccessTokenGetter,
} from "./providers/claude-code-provider.js";
import { runClaudeFileGc, deleteClaudeFile } from "./providers/claude-file-gc.js";
import type { ClaudeFileGcMetadata } from "./providers/claude-file-gc.js";
import type { ClaudeCodeAuth, ClaudeCodeAuthProvider } from "./providers/claude-code-auth.js";
import type { OpenAiCodexAuth, OpenAiCodexAuthProvider } from "./providers/openai-codex-auth.js";
import type {
  ClaudeFileCacheDao,
  ClaudeFileCacheRecord,
  ClaudeFileCacheSaveInput,
} from "./providers/claude-file-cache.dao.js";

export {
  createLlmClient,
  attachLlmProviderFailureContext,
  getLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  createDeepSeekProvider,
  createOpenAiProvider,
  createOpenAiCodexProvider,
  createClaudeCodeProvider,
  createClaudeCodeAccessTokenGetter,
  runClaudeFileGc,
  deleteClaudeFile,
  type LlmClient,
  type LlmChatOptions,
  type LlmChatDirectOptions,
  type LlmListAvailableProvidersOptions,
  type LlmChatDirectResult,
  type LlmChatCallObservation,
  type LlmChatCallSuccessObservation,
  type LlmChatCallErrorObservation,
  type LlmProvider,
  type LlmProviderChatResult,
  type LlmProviderFailureContext,
  type JsonSchema,
  type LlmContentPart,
  type LlmImageContentPart,
  type LlmMessage,
  type LlmProviderId,
  type LlmTextContentPart,
  type LlmToolCall,
  type Tool,
  type LlmToolChoice,
  type LlmUsage,
  type LlmImageInput,
  type LlmChatRequest,
  type LlmChatResponsePayload,
  type ClaudeCodeAuth,
  type ClaudeCodeAuthProvider,
  type OpenAiCodexAuth,
  type OpenAiCodexAuthProvider,
  type ClaudeFileCacheDao,
  type ClaudeFileCacheRecord,
  type ClaudeFileCacheSaveInput,
  type ClaudeFileGcMetadata,
};
