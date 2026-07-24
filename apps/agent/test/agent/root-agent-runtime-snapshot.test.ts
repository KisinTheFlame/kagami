import { describe, expect, it } from "vitest";
import { PersistedRootAgentRuntimeSnapshotSchema } from "../../src/agent/runtime/root-agent/persistence/root-agent-runtime-snapshot.js";

// thinking 块恢复（#573）：zod 默认 strip 未知键，快照 schema 不认识 thinkingBlocks 就会在
// 恢复期静默剥掉——崩溃恢复落在 tool loop 中段时缺块续轮有 400 风险。这里钉死两个方向：
// 新快照带块往返保真；旧快照（无该字段）恢复不受影响。

function createSnapshot(messages: unknown[]): unknown {
  return {
    runtimeKey: "root",
    schemaVersion: 1,
    contextSnapshot: { messages },
    lastWakeReminderAt: null,
  };
}

describe("PersistedRootAgentRuntimeSnapshotSchema thinking blocks", () => {
  it("should round-trip assistant thinkingBlocks verbatim", () => {
    const parsed = PersistedRootAgentRuntimeSnapshotSchema.parse(
      createSnapshot([
        {
          role: "assistant",
          content: "draft",
          toolCalls: [{ id: "call_1", name: "lookup", arguments: {} }],
          thinkingBlocks: [
            { type: "thinking", thinking: "推理过程", signature: "sig-1" },
            { type: "redacted_thinking", data: "opaque-bytes" },
          ],
        },
      ]),
    );

    const assistant = parsed.contextSnapshot.messages[0];
    if (assistant?.role !== "assistant") {
      throw new Error("expected assistant message");
    }
    expect(assistant.thinkingBlocks).toEqual([
      { type: "thinking", thinking: "推理过程", signature: "sig-1" },
      { type: "redacted_thinking", data: "opaque-bytes" },
    ]);
  });

  it("should restore legacy snapshots without thinkingBlocks unchanged", () => {
    const parsed = PersistedRootAgentRuntimeSnapshotSchema.parse(
      createSnapshot([
        { role: "user", content: "ping" },
        { role: "assistant", content: "pong", toolCalls: [] },
        { role: "tool", toolCallId: "call_1", content: "result" },
      ]),
    );

    const assistant = parsed.contextSnapshot.messages[1];
    if (assistant?.role !== "assistant") {
      throw new Error("expected assistant message");
    }
    expect(assistant).not.toHaveProperty("thinkingBlocks");
  });
});
