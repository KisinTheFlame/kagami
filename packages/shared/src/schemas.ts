import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const GreetingInputSchema = z.object({
  appName: z.string().min(1),
});

export type GreetingInput = z.infer<typeof GreetingInputSchema>;

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
  maxSteps: z.preprocess(parseNumberInput, z.number().int().positive().max(8).optional()),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunResponseSchema = z.object({
  output: z.string(),
  steps: z.number().int().positive(),
});

export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;
