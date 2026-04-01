import type { PersistedRootAgentRuntimeSnapshot } from "./root-agent-runtime-snapshot.js";

export const ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY = "root-agent";
export const ROOT_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION = 2;

export interface RootAgentRuntimeSnapshotRepository {
  load(runtimeKey: string): Promise<PersistedRootAgentRuntimeSnapshot | null>;
  save(snapshot: PersistedRootAgentRuntimeSnapshot): Promise<void>;
  delete(runtimeKey: string): Promise<void>;
}
