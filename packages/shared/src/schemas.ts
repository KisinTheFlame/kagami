import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const LlmToolCallPayloadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: JsonRecordSchema,
  })
  .strict();

export type LlmToolCallPayload = z.infer<typeof LlmToolCallPayloadSchema>;

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
    tools: z.array(
      z
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
        .strict(),
    ),
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
    provider: z.enum(["deepseek", "openai"]),
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
const parseNumberInput = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
};

export const LlmChatCallListQuerySchema = z.object({
  page: z.preprocess(parseNumberInput, z.number().int().positive()).default(1),
  pageSize: z.preprocess(parseNumberInput, z.number().int().positive().max(100)).default(20),
});

export type LlmChatCallListQuery = z.infer<typeof LlmChatCallListQuerySchema>;

export const LlmChatCallItemSchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["success", "failed"]),
  requestPayload: JsonRecordSchema,
  responsePayload: JsonRecordSchema.nullable(),
  error: JsonRecordSchema.nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export type LlmChatCallItem = z.infer<typeof LlmChatCallItemSchema>;

export const LlmChatCallListResponseSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  hasMore: z.boolean(),
  items: z.array(LlmChatCallItemSchema),
});

export type LlmChatCallListResponse = z.infer<typeof LlmChatCallListResponseSchema>;

export const AgentRunRequestSchema = z.object({
  input: z.string().min(1),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunResponseSchema = z.object({
  output: z.string(),
  steps: z.number().int().positive(),
});

export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;

export const AgentEventEnqueueRequestSchema = z.object({
  message: z.string().min(1),
});

export type AgentEventEnqueueRequest = z.infer<typeof AgentEventEnqueueRequestSchema>;

export const AgentEventEnqueueResponseSchema = z.object({
  accepted: z.literal(true),
  queued: z.number().int().positive(),
});

export type AgentEventEnqueueResponse = z.infer<typeof AgentEventEnqueueResponseSchema>;
