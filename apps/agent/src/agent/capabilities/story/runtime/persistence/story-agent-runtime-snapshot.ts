import { z } from "zod";
import {
  PersistedAgentContextSnapshotSchema,
  type PersistedAgentContextSnapshot,
} from "../../../../runtime/root-agent/persistence/root-agent-runtime-snapshot.js";

export const PersistedStoryAgentRuntimeSnapshotSchema = z.object({
  runtimeKey: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  contextSnapshot: PersistedAgentContextSnapshotSchema,
  lastProcessedMessageSeq: z.number().int().nonnegative(),
});

export type PersistedStoryAgentRuntimeSnapshot = z.infer<
  typeof PersistedStoryAgentRuntimeSnapshotSchema
>;

export type StoryAgentContextSnapshot = PersistedAgentContextSnapshot;
