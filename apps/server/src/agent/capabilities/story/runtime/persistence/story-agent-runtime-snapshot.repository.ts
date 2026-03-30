import type { PersistedStoryAgentRuntimeSnapshot } from "./story-agent-runtime-snapshot.js";

export interface StoryAgentRuntimeSnapshotRepository {
  load(runtimeKey: string): Promise<PersistedStoryAgentRuntimeSnapshot | null>;
  save(snapshot: PersistedStoryAgentRuntimeSnapshot): Promise<void>;
  delete(runtimeKey: string): Promise<void>;
}
