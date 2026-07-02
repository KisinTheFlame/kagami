import { describe, expect, it, vi } from "vitest";
import { TaskAgentMaxRoundsExceededError } from "@kagami/agent-runtime";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

/**
 * host 层的摘要超轮降级契约（toolChoice auto 后新增的失败形态）：
 * SummaryTaskAgent 跑满 maxRounds 未 finalize 时抛 TaskAgentMaxRoundsExceededError，
 * host 必须吞掉它并放弃本次压缩（返回 false、不 apply 任何 effect、不 rethrow）——
 * 这是 KV 缓存关键的 replaceMessages 路径，降级失手会让主循环崩溃或压缩空转。
 */
describe("RootAgentHost — 摘要超轮降级", () => {
  it("compactEntireContext：summarizer 超轮 → 返回 false 且不 apply effect", async () => {
    const apply = vi.fn(async () => ({ appendedMessages: [] }));
    const invoke = vi.fn().mockRejectedValue(new TaskAgentMaxRoundsExceededError(4));
    const host = new RootAgentHost({
      context: {
        getSnapshot: async () => ({
          systemPrompt: "sys",
          messages: [{ role: "user", content: "m" }],
        }),
      },
      eventQueue: {},
      session: {},
      interpreter: { apply },
      contextSummarizer: { invoke },
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    await expect(host.compactEntireContext()).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("阈值压缩超轮失败后进入冷却：冷却期内不再重试 summarizer", async () => {
    const apply = vi.fn(async () => ({ appendedMessages: [] }));
    const invoke = vi.fn().mockRejectedValue(new TaskAgentMaxRoundsExceededError(4));
    let nowMs = 1_000_000;
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `m${String(i)}`,
    }));
    const host = new RootAgentHost({
      context: {
        getSnapshot: async () => ({ systemPrompt: "sys", messages }),
      },
      eventQueue: {},
      session: {},
      interpreter: { apply },
      contextSummarizer: { invoke },
      contextCompactionTotalTokenThreshold: 1,
      now: () => new Date(nowMs),
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    // 第一次：真的调 summarizer，超轮 → 降级 + 进入冷却。
    await expect(host.compactContextIfNeeded(100)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);

    // 冷却期内（下一轮 commit 立刻又触发）：不再白烧 maxRounds 次调用。
    nowMs += 1_000;
    await expect(host.compactContextIfNeeded(100)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);

    // 冷却期过后恢复重试。
    nowMs += 700_000;
    await expect(host.compactContextIfNeeded(100)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("compactEntireContext：summarizer 正常返回 → apply replace_leading_messages 并返回 true", async () => {
    const apply = vi.fn(async (_effects: readonly { type: string; count: number }[]) => ({
      appendedMessages: [],
    }));
    const invoke = vi.fn().mockResolvedValue("累计摘要");
    const host = new RootAgentHost({
      context: {
        getSnapshot: async () => ({
          systemPrompt: "sys",
          messages: [
            { role: "user", content: "m1" },
            { role: "user", content: "m2" },
          ],
        }),
      },
      eventQueue: {},
      session: {},
      interpreter: { apply },
      contextSummarizer: { invoke },
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    await expect(host.compactEntireContext()).resolves.toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    const effects = apply.mock.calls[0][0];
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("replace_leading_messages");
    // count = 被摘要的全部消息数
    expect(effects[0].count).toBe(2);
  });
});
