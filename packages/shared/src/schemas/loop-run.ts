import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  JsonValueSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const LoopRunStatusSchema = z.enum(["success", "failed", "partial"]);
export type LoopRunStatus = z.infer<typeof LoopRunStatusSchema>;

export const LoopRunTimelineStepStatusSchema = z.enum(["success", "failed", "partial"]);
export type LoopRunTimelineStepStatus = z.infer<typeof LoopRunTimelineStepStatusSchema>;

export const LoopRunTriggerMessageSchema = z
  .object({
    messageId: z.number().int().nullable(),
    groupId: z.string().min(1),
    userId: z.string().min(1),
    nickname: z.string().min(1),
    rawMessage: z.string(),
    messageSegments: z.array(JsonValueSchema),
    eventTime: z.string().datetime().nullable(),
  })
  .strict();

export type LoopRunTriggerMessage = z.infer<typeof LoopRunTriggerMessageSchema>;

const LoopRunTimelineItemBaseSchema = z
  .object({
    id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    title: z.string().min(1),
    status: LoopRunTimelineStepStatusSchema,
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const LoopRunTriggerTimelineItemSchema = LoopRunTimelineItemBaseSchema.extend({
  type: z.literal("trigger_message"),
  trigger: LoopRunTriggerMessageSchema,
});

export const LoopRunLlmStepSchema = LoopRunTimelineItemBaseSchema.extend({
  type: z.literal("llm_call"),
  provider: z.string().min(1),
  model: z.string().min(1),
  requestId: z.string().min(1),
  requestPayload: JsonRecordSchema,
  responsePayload: JsonRecordSchema.nullable(),
  usage: JsonRecordSchema.nullable(),
  error: JsonRecordSchema.nullable(),
});

export const LoopRunToolCallStepSchema = LoopRunTimelineItemBaseSchema.extend({
  type: z.literal("tool_call"),
  toolName: z.string().min(1),
  toolCallId: z.string().min(1),
  arguments: JsonRecordSchema,
});

export const LoopRunToolResultStepSchema = LoopRunTimelineItemBaseSchema.extend({
  type: z.literal("tool_result"),
  toolName: z.string().min(1),
  toolCallId: z.string().min(1),
  result: JsonValueSchema,
});

export const LoopRunFinalResultStepSchema = LoopRunTimelineItemBaseSchema.extend({
  type: z.literal("final_result"),
  outcome: JsonRecordSchema,
});

export const LoopRunTimelineItemSchema = z.discriminatedUnion("type", [
  LoopRunTriggerTimelineItemSchema,
  LoopRunLlmStepSchema,
  LoopRunToolCallStepSchema,
  LoopRunToolResultStepSchema,
  LoopRunFinalResultStepSchema,
]);

export type LoopRunTimelineItem = z.infer<typeof LoopRunTimelineItemSchema>;
export type LoopRunLlmStep = z.infer<typeof LoopRunLlmStepSchema>;
export type LoopRunToolCallStep = z.infer<typeof LoopRunToolCallStepSchema>;

export const LoopRunSummarySchema = z
  .object({
    llmCallCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    toolSuccessCount: z.number().int().nonnegative(),
    toolFailureCount: z.number().int().nonnegative(),
  })
  .strict();

export type LoopRunSummary = z.infer<typeof LoopRunSummarySchema>;

export const LoopRunDetailResponseSchema = z
  .object({
    id: z.string().min(1),
    status: LoopRunStatusSchema,
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    groupId: z.string().min(1),
    trigger: LoopRunTriggerMessageSchema,
    summary: LoopRunSummarySchema,
    timeline: z.array(LoopRunTimelineItemSchema),
    raw: JsonRecordSchema,
  })
  .strict();

export type LoopRunDetailResponse = z.infer<typeof LoopRunDetailResponseSchema>;

export const LoopRunListQuerySchema = PaginationQuerySchema.extend({
  status: z.preprocess(parseOptionalStringInput, LoopRunStatusSchema.optional()),
  groupId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
});

export type LoopRunListQuery = z.infer<typeof LoopRunListQuerySchema>;

export const LoopRunListItemSchema = z
  .object({
    id: z.string().min(1),
    status: LoopRunStatusSchema,
    groupId: z.string().min(1),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    trigger: LoopRunTriggerMessageSchema,
    summary: LoopRunSummarySchema,
  })
  .strict();

export type LoopRunListItem = z.infer<typeof LoopRunListItemSchema>;

export const LoopRunListResponseSchema = createPaginatedResponseSchema(LoopRunListItemSchema);

export type LoopRunListResponse = z.infer<typeof LoopRunListResponseSchema>;
