import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const JsonRecordSchema = z.record(z.string(), z.unknown());

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

const parseOptionalStringInput = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const PaginationQuerySchema = z.object({
  page: z.preprocess(parseNumberInput, z.number().int().positive()).default(1),
  pageSize: z.preprocess(parseNumberInput, z.number().int().positive().max(100)).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export function createPaginatedResponseSchema<ItemSchema extends z.ZodTypeAny>(
  itemSchema: ItemSchema,
) {
  return z.object({
    pagination: PaginationSchema,
    items: z.array(itemSchema),
  });
}

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

export const LlmChatCallStatusSchema = z.enum(["success", "failed"]);

export type LlmChatCallStatus = z.infer<typeof LlmChatCallStatusSchema>;

export const LlmChatCallListQuerySchema = PaginationQuerySchema.extend({
  status: z.preprocess(parseOptionalStringInput, LlmChatCallStatusSchema.optional()),
});

export type LlmChatCallListQuery = z.infer<typeof LlmChatCallListQuerySchema>;

export const LlmChatCallItemSchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: LlmChatCallStatusSchema,
  requestPayload: JsonRecordSchema,
  responsePayload: JsonRecordSchema.nullable(),
  error: JsonRecordSchema.nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export type LlmChatCallItem = z.infer<typeof LlmChatCallItemSchema>;

export const LlmChatCallListResponseSchema = createPaginatedResponseSchema(LlmChatCallItemSchema);

export type LlmChatCallListResponse = z.infer<typeof LlmChatCallListResponseSchema>;

export const AppLogLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export type AppLogLevel = z.infer<typeof AppLogLevelSchema>;

export const AppLogListQuerySchema = PaginationQuerySchema.extend({
  level: z.preprocess(parseOptionalStringInput, AppLogLevelSchema.optional()),
  traceId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  message: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  source: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  startAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
  endAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
}).superRefine((value, ctx) => {
  if (!value.startAt || !value.endAt) {
    return;
  }

  if (new Date(value.startAt).getTime() > new Date(value.endAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startAt"],
      message: "startAt must be less than or equal to endAt",
    });
  }
});

export type AppLogListQuery = z.infer<typeof AppLogListQuerySchema>;

export const AppLogItemSchema = z.object({
  id: z.number().int().positive(),
  traceId: z.string().min(1),
  level: AppLogLevelSchema,
  message: z.string().min(1),
  metadata: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type AppLogItem = z.infer<typeof AppLogItemSchema>;

export const AppLogListResponseSchema = createPaginatedResponseSchema(AppLogItemSchema);

export type AppLogListResponse = z.infer<typeof AppLogListResponseSchema>;

export const NapcatEventListQuerySchema = PaginationQuerySchema.extend({
  postType: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  messageType: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  userId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  keyword: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  startAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
  endAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
}).superRefine((value, ctx) => {
  if (!value.startAt || !value.endAt) {
    return;
  }

  if (new Date(value.startAt).getTime() > new Date(value.endAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startAt"],
      message: "startAt must be less than or equal to endAt",
    });
  }
});

export type NapcatEventListQuery = z.infer<typeof NapcatEventListQuerySchema>;

export const NapcatEventItemSchema = z.object({
  id: z.number().int().positive(),
  postType: z.string().min(1),
  messageType: z.string().min(1).nullable(),
  subType: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  groupId: z.string().min(1).nullable(),
  rawMessage: z.string().min(1).nullable(),
  eventTime: z.string().datetime().nullable(),
  payload: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type NapcatEventItem = z.infer<typeof NapcatEventItemSchema>;

export const NapcatEventListResponseSchema = createPaginatedResponseSchema(NapcatEventItemSchema);

export type NapcatEventListResponse = z.infer<typeof NapcatEventListResponseSchema>;

export const AgentRunRequestSchema = z.object({
  input: z.string().min(1),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunResponseSchema = z.object({
  output: z.string(),
  steps: z.number().int().positive(),
});

export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;

export const NapcatSendPrivateMessageRequestSchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1),
});

export type NapcatSendPrivateMessageRequest = z.infer<typeof NapcatSendPrivateMessageRequestSchema>;

export const NapcatSendPrivateMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});

export type NapcatSendPrivateMessageResponse = z.infer<
  typeof NapcatSendPrivateMessageResponseSchema
>;

export const NapcatSendGroupMessageRequestSchema = z.object({
  groupId: z.string().min(1),
  message: z.string().min(1),
});

export type NapcatSendGroupMessageRequest = z.infer<typeof NapcatSendGroupMessageRequestSchema>;

export const NapcatSendGroupMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});

export type NapcatSendGroupMessageResponse = z.infer<typeof NapcatSendGroupMessageResponseSchema>;

export { z };
