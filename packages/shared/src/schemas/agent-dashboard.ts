import { z } from "zod";
import { LlmProviderOptionSchema } from "./llm-chat.js";

export const AgentLoopStateSchema = z.enum([
  "starting",
  "idle",
  "consuming_events",
  "calling_llm",
  "executing_tool",
  "waiting",
  "crashed",
]);

export type AgentLoopState = z.infer<typeof AgentLoopStateSchema>;

export const AgentDashboardRuntimeErrorSchema = z
  .object({
    name: z.string().min(1),
    message: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type AgentDashboardRuntimeError = z.infer<typeof AgentDashboardRuntimeErrorSchema>;

export const AgentDashboardContextItemKindSchema = z.enum(["llm_message", "event"]);

export type AgentDashboardContextItemKind = z.infer<typeof AgentDashboardContextItemKindSchema>;

export const AgentDashboardContextItemSchema = z
  .object({
    kind: AgentDashboardContextItemKindSchema,
    label: z.string().min(1),
    preview: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export type AgentDashboardContextItem = z.infer<typeof AgentDashboardContextItemSchema>;

export const AgentDashboardToolCallSchema = z
  .object({
    name: z.string().min(1),
    argumentsPreview: z.string(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type AgentDashboardToolCall = z.infer<typeof AgentDashboardToolCallSchema>;

export const AgentDashboardLlmCallSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    assistantContentPreview: z.string(),
    toolCallNames: z.array(z.string().min(1)),
    totalTokens: z.number().int().nonnegative().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type AgentDashboardLlmCall = z.infer<typeof AgentDashboardLlmCallSchema>;

export const AgentDashboardGroupSchema = z
  .object({
    groupId: z.string().min(1),
    groupName: z.string().min(1).optional(),
    unreadCount: z.number().int().nonnegative(),
    hasEntered: z.boolean(),
  })
  .strict();

export type AgentDashboardGroup = z.infer<typeof AgentDashboardGroupSchema>;

export const AgentDashboardResetContextResponseSchema = z
  .object({
    ok: z.literal(true),
    resetAt: z.string().datetime(),
  })
  .strict();

export type AgentDashboardResetContextResponse = z.infer<
  typeof AgentDashboardResetContextResponseSchema
>;

export const AgentDashboardSnapshotSchema = z
  .object({
    generatedAt: z.string().datetime(),
    runtime: z
      .object({
        initialized: z.boolean(),
        loopState: AgentLoopStateSchema,
        lastError: AgentDashboardRuntimeErrorSchema.nullable(),
        lastActivityAt: z.string().datetime().nullable(),
        lastRoundCompletedAt: z.string().datetime().nullable(),
        lastCompactionAt: z.string().datetime().nullable(),
      })
      .strict(),
    session: z
      .object({
        kind: z.enum(["portal", "qq_group", "ithome", "zone_out", "waiting"]),
        currentGroupId: z.string().min(1).nullable(),
        waitingDeadlineAt: z.string().datetime().nullable(),
        availableInvokeTools: z.array(z.string().min(1)),
      })
      .strict(),
    queue: z
      .object({
        pendingEventCount: z.number().int().nonnegative(),
      })
      .strict(),
    groups: z.array(AgentDashboardGroupSchema),
    context: z
      .object({
        messageCount: z.number().int().nonnegative(),
        compactionTotalTokenThreshold: z.number().int().positive(),
        recentItems: z.array(AgentDashboardContextItemSchema),
        recentItemsTruncated: z.boolean(),
      })
      .strict(),
    activity: z
      .object({
        lastToolCall: AgentDashboardToolCallSchema.nullable(),
        lastToolResultPreview: z.string().nullable(),
        lastLlmCall: AgentDashboardLlmCallSchema.nullable(),
      })
      .strict(),
    providers: z.array(LlmProviderOptionSchema),
    config: z
      .object({
        listenGroupIds: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict();

export type AgentDashboardSnapshot = z.infer<typeof AgentDashboardSnapshotSchema>;
