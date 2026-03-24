import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const LlmProviderIdSchema = z.enum(["deepseek", "openai", "openai-codex", "claude-code"]);

export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const LlmToolCallPayloadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: JsonRecordSchema,
  })
  .strict();

export type LlmToolCallPayload = z.infer<typeof LlmToolCallPayloadSchema>;

export const LlmToolDefinitionSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z
      .object({
        type: z.literal("object"),
        properties: JsonRecordSchema,
      })
      .strict(),
  })
  .strict();

export type LlmToolDefinition = z.infer<typeof LlmToolDefinitionSchema>;

export const LlmRequestMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      content: z.string(),
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

export type LlmRequestMessage = z.infer<typeof LlmRequestMessageSchema>;

export const LlmChatRequestPayloadSchema = z
  .object({
    system: z.string().optional(),
    messages: z.array(LlmRequestMessageSchema),
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
    model: z.string().min(1).optional(),
  })
  .strict();

export type LlmChatRequestPayload = z.infer<typeof LlmChatRequestPayloadSchema>;

export const LlmChatResponsePayloadSchema = z
  .object({
    provider: LlmProviderIdSchema,
    model: z.string().min(1),
    message: z
      .object({
        role: z.literal("assistant"),
        content: z.string(),
        toolCalls: z.array(LlmToolCallPayloadSchema),
      })
      .strict(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().optional(),
        completionTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type LlmChatResponsePayload = z.infer<typeof LlmChatResponsePayloadSchema>;

export const LlmChatErrorPayloadSchema = z
  .object({
    name: z.string().min(1),
    message: z.string().min(1),
    code: z.string().min(1).optional(),
  })
  .strict();

export type LlmChatErrorPayload = z.infer<typeof LlmChatErrorPayloadSchema>;

export const LlmChatCallStatusSchema = z.enum(["success", "failed"]);

export type LlmChatCallStatus = z.infer<typeof LlmChatCallStatusSchema>;

export const LlmChatCallListQuerySchema = PaginationQuerySchema.extend({
  provider: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  model: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  status: z.preprocess(parseOptionalStringInput, LlmChatCallStatusSchema.optional()),
});

export type LlmChatCallListQuery = z.infer<typeof LlmChatCallListQuerySchema>;

export const LlmChatCallItemSchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  extension: JsonRecordSchema.nullable(),
  status: LlmChatCallStatusSchema,
  requestPayload: JsonRecordSchema,
  responsePayload: JsonRecordSchema.nullable(),
  nativeRequestPayload: JsonRecordSchema.nullable(),
  nativeResponsePayload: JsonRecordSchema.nullable(),
  error: JsonRecordSchema.nullable(),
  nativeError: JsonRecordSchema.nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export type LlmChatCallItem = z.infer<typeof LlmChatCallItemSchema>;

export const LlmChatCallListResponseSchema = createPaginatedResponseSchema(LlmChatCallItemSchema);

export type LlmChatCallListResponse = z.infer<typeof LlmChatCallListResponseSchema>;

export const LlmProviderOptionSchema = z
  .object({
    id: LlmProviderIdSchema,
    models: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type LlmProviderOption = z.infer<typeof LlmProviderOptionSchema>;

export const LlmProviderListResponseSchema = z
  .object({
    providers: z.array(LlmProviderOptionSchema),
  })
  .strict();

export type LlmProviderListResponse = z.infer<typeof LlmProviderListResponseSchema>;

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

export const LlmPlaygroundChatResponseSchema = LlmChatResponsePayloadSchema;

export type LlmPlaygroundChatResponse = z.infer<typeof LlmPlaygroundChatResponseSchema>;
