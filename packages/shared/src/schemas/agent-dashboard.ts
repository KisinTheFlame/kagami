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

export const AgentDashboardRuntimeSchema = z
  .object({
    initialized: z.boolean(),
    loopState: AgentLoopStateSchema,
    lastError: AgentDashboardRuntimeErrorSchema.nullable(),
    lastActivityAt: z.string().datetime().nullable(),
    lastRoundCompletedAt: z.string().datetime().nullable(),
    lastCompactionAt: z.string().datetime().nullable(),
  })
  .strict();

export type AgentDashboardRuntime = z.infer<typeof AgentDashboardRuntimeSchema>;

export const AgentDashboardContextSchema = z
  .object({
    messageCount: z.number().int().nonnegative(),
    compactionTotalTokenThreshold: z.number().int().positive(),
    recentItems: z.array(AgentDashboardContextItemSchema),
    recentItemsTruncated: z.boolean(),
  })
  .strict();

export type AgentDashboardContext = z.infer<typeof AgentDashboardContextSchema>;

export const AgentDashboardActivitySchema = z
  .object({
    lastToolCall: AgentDashboardToolCallSchema.nullable(),
    lastToolResultPreview: z.string().nullable(),
    lastLlmCall: AgentDashboardLlmCallSchema.nullable(),
  })
  .strict();

export type AgentDashboardActivity = z.infer<typeof AgentDashboardActivitySchema>;

export const RootAgentDashboardStateStackItemSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export type RootAgentDashboardStateStackItem = z.infer<
  typeof RootAgentDashboardStateStackItemSchema
>;

export const RootAgentDashboardChildStateSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string(),
  })
  .strict();

export type RootAgentDashboardChildState = z.infer<typeof RootAgentDashboardChildStateSchema>;

export const RootAgentDashboardSessionSchema = z
  .object({
    focusedStateId: z.string().min(1),
    focusedStateDisplayName: z.string().min(1),
    focusedStateDescription: z.string(),
    stateStack: z.array(RootAgentDashboardStateStackItemSchema),
    children: z.array(RootAgentDashboardChildStateSchema),
    availableInvokeTools: z.array(z.string().min(1)),
    waiting: z
      .object({
        active: z.boolean(),
        deadlineAt: z.string().datetime().nullable(),
        resumeStateId: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export type RootAgentDashboardSession = z.infer<typeof RootAgentDashboardSessionSchema>;

export const RootAgentDashboardQueueSchema = z
  .object({
    pendingEventCount: z.number().int().nonnegative(),
  })
  .strict();

export type RootAgentDashboardQueue = z.infer<typeof RootAgentDashboardQueueSchema>;

export const StoryAgentPendingBatchSchema = z
  .object({
    firstSeq: z.number().int().positive(),
    lastSeq: z.number().int().positive(),
  })
  .strict();

export type StoryAgentPendingBatch = z.infer<typeof StoryAgentPendingBatchSchema>;

export const StoryAgentDashboardDetailsSchema = z
  .object({
    lastProcessedMessageSeq: z.number().int().nonnegative(),
    pendingMessageCount: z.number().int().nonnegative(),
    pendingBatch: StoryAgentPendingBatchSchema.nullable(),
    batchSize: z.number().int().positive(),
    idleFlushMs: z.number().int().positive(),
  })
  .strict();

export type StoryAgentDashboardDetails = z.infer<typeof StoryAgentDashboardDetailsSchema>;

const AgentDashboardAgentBaseSchema = z
  .object({
    id: z.enum(["root", "story"]),
    label: z.string().min(1),
    runtime: AgentDashboardRuntimeSchema,
    context: AgentDashboardContextSchema,
    activity: AgentDashboardActivitySchema,
  })
  .strict();

export const RootAgentDashboardSnapshotSchema = AgentDashboardAgentBaseSchema.extend({
  id: z.literal("root"),
  kind: z.literal("root"),
  session: RootAgentDashboardSessionSchema,
  queue: RootAgentDashboardQueueSchema,
  providers: z.array(LlmProviderOptionSchema),
}).strict();

export type RootAgentDashboardSnapshot = z.infer<typeof RootAgentDashboardSnapshotSchema>;

export const StoryAgentDashboardSnapshotSchema = AgentDashboardAgentBaseSchema.extend({
  id: z.literal("story"),
  kind: z.literal("story"),
  story: StoryAgentDashboardDetailsSchema,
}).strict();

export type StoryAgentDashboardSnapshot = z.infer<typeof StoryAgentDashboardSnapshotSchema>;

export const AgentDashboardAgentSnapshotSchema = z.discriminatedUnion("kind", [
  RootAgentDashboardSnapshotSchema,
  StoryAgentDashboardSnapshotSchema,
]);

export type AgentDashboardAgentSnapshot = z.infer<typeof AgentDashboardAgentSnapshotSchema>;

export const AgentDashboardSnapshotSchema = z
  .object({
    generatedAt: z.string().datetime(),
    agents: z.array(AgentDashboardAgentSnapshotSchema),
    config: z
      .object({
        listenGroupIds: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict();

export type AgentDashboardSnapshot = z.infer<typeof AgentDashboardSnapshotSchema>;
