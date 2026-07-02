import { JsonRecordSchema } from "@kagami/http/wire";
import {
  LlmChatResponsePayloadSchema,
  LlmProviderIdSchema,
  LlmToolCallPayloadSchema,
  LlmToolDefinitionSchema,
} from "@kagami/llm-api/llm-chat";
import { z } from "zod";

// === Playground（管理台 LLM 调试）wire schema，agent 服务产出（#279 PR5） ===
//
// 自 @kagami/shared/schemas/llm-chat 迁入。逐字段建模是既有状态原样保留（D3）：
// llm 内部 /internal/chat* 的信封级判例（#237）不适用于这里。

export const PlaygroundTextContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

export const PlaygroundImageContentPartSchema = z
  .object({
    type: z.literal("image"),
    fileName: z.string().min(1).optional(),
    mimeType: z.string().min(1),
    dataUrl: z.string().min(1),
  })
  .strict();

export const PlaygroundContentPartSchema = z.discriminatedUnion("type", [
  PlaygroundTextContentPartSchema,
  PlaygroundImageContentPartSchema,
]);

export type PlaygroundContentPart = z.infer<typeof PlaygroundContentPartSchema>;

export const PlaygroundMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(PlaygroundContentPartSchema)]),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(LlmToolCallPayloadSchema),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      toolCallId: z.string().min(1),
      content: z.string(),
    })
    .strict(),
]);

export type PlaygroundMessage = z.infer<typeof PlaygroundMessageSchema>;

export const LlmPlaygroundToolListResponseSchema = z
  .object({
    tools: z.array(LlmToolDefinitionSchema),
  })
  .strict();

export type LlmPlaygroundToolListResponse = z.infer<typeof LlmPlaygroundToolListResponseSchema>;

export const LlmPlaygroundChatRequestSchema = z
  .object({
    provider: LlmProviderIdSchema,
    model: z.string().min(1),
    system: z.string().optional(),
    messages: z.array(PlaygroundMessageSchema),
    tools: z.array(LlmToolDefinitionSchema),
    toolChoice: z.union([
      z.literal("required"),
      z.literal("auto"),
      z.literal("none"),
      z
        .object({
          tool_name: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict();

export type LlmPlaygroundChatRequest = z.infer<typeof LlmPlaygroundChatRequestSchema>;

export const LlmPlaygroundChatResponseSchema = LlmChatResponsePayloadSchema.extend({
  nativeRequestPayload: JsonRecordSchema.nullable(),
}).strict();

export type LlmPlaygroundChatResponse = z.infer<typeof LlmPlaygroundChatResponseSchema>;
