import type { PersistedRootAgentRuntimeSnapshot } from "./root-agent-runtime-snapshot.js";

export const ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY = "root-agent";
// v4：状态树退役，session 不再持久化（移除 sessionSnapshot 字段与 session_snapshot 列）。
export const ROOT_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION = 4;

export interface RootAgentRuntimeSnapshotRepository {
  load(runtimeKey: string): Promise<PersistedRootAgentRuntimeSnapshot | null>;
  save(snapshot: PersistedRootAgentRuntimeSnapshot): Promise<void>;
  delete(runtimeKey: string): Promise<void>;
}
