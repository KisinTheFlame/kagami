import { LLM_PROVIDER_IDS } from "@kagami/llm";
import { z } from "zod";
import { JsonRecordSchema } from "@kagami/http/wire";

// provider 标识全集的单源在 @kagami/llm；这里只派生 zod schema，不再手写字面量。
// 需要 `LlmProviderId` 类型的代码请直接从 @kagami/llm 导入（项目禁止 re-export barrel）。
export const LlmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);

export const LlmToolCallPayloadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: JsonRecordSchema,
  })
  .strict();

export type LlmToolCallPayload = z.infer<typeof LlmToolCallPayloadSchema>;

/**
 * assistant 消息携带的 thinking 块（issue #573）。不透明存储、原样回放：signature /
 * data 都是 Anthropic 侧校验的黑盒字节，落库与回放链路不做任何加工。
 */
export const LlmThinkingBlockPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("thinking"),
      thinking: z.string(),
      signature: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("redacted_thinking"),
      data: z.string(),
    })
    .strict(),
]);

export type LlmThinkingBlockPayload = z.infer<typeof LlmThinkingBlockPayloadSchema>;

export const LlmThinkingEffortSchema = z.enum(["low", "medium", "high"]);

export const LlmToolDefinitionSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    // parameters 是开放式 JSON Schema：真实工具普遍带 required / enum / $defs 等关键字，
    // 故只校验 object 顶层骨架、不加 .strict()，其余关键字按 zod 默认 strip。viewer 仅用
    // tool.name，历史 replay 也只需骨架，丢弃这些关键字无影响（与旧手搓 parser 一致）。
    parameters: z.object({
      type: z.literal("object"),
      properties: JsonRecordSchema,
    }),
  })
  .strict();

export type LlmToolDefinition = z.infer<typeof LlmToolDefinitionSchema>;

export const LlmRequestTextContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

/**
 * user 消息里的图片内容块在落库前已剥掉 base64 原图（见 server 侧
 * `toRecordableChatRequest`），只留元数据：`mimeType` + 可选 `filename` + 原图字节数。
 */
export const LlmRequestImageContentPartSchema = z
  .object({
    type: z.literal("image"),
    mimeType: z.string(),
    filename: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const LlmRequestUserContentPartSchema = z.discriminatedUnion("type", [
  LlmRequestTextContentPartSchema,
  LlmRequestImageContentPartSchema,
]);

export type LlmRequestUserContentPart = z.infer<typeof LlmRequestUserContentPartSchema>;

export const LlmRequestMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(LlmRequestUserContentPartSchema)]),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(LlmToolCallPayloadSchema),
      thinkingBlocks: z.array(LlmThinkingBlockPayloadSchema).optional(),
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
    // adaptive thinking effort 档位（issue #573）：usage 配置在 llm 服务侧解析后注入，
    // 落库 shape 随之记录，viewer 可见该次调用是否开了 thinking。
    thinking: LlmThinkingEffortSchema.optional(),
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
        thinkingBlocks: z.array(LlmThinkingBlockPayloadSchema).optional(),
      })
      .strict(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().optional(),
        completionTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
        cacheHitTokens: z.number().int().nonnegative().optional(),
        cacheMissTokens: z.number().int().nonnegative().optional(),
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
