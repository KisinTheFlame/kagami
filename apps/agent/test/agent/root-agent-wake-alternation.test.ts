import { describe, expect, it, vi } from "vitest";
import type { LlmMessage } from "@kagami/llm-client";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";

/**
 * 角色交替不变量（防 400 死循环，issue #268 语义修订的配套）：
 *
 * 纯文本轮会把 assistant(text, []) 留在上下文尾部；若随后被空闲自唤醒（wake 是 no-op、
 * 不追加 user 消息）唤醒，下一轮又出纯文本就会两条 assistant 相邻 → provider 要求
 * user/assistant 交替、直接 400 且每轮复发。`appendWakeReminderIfNeeded` 起轮前若发现
 * 上下文尾部是 assistant，就**无条件**补一条 user 角色 wake-reminder 补齐交替，即便还在
 * 同一个 30 分钟 wake-reminder bucket 内也照补。
 */
describe("RootAgentHost.appendWakeReminderIfNeeded — 尾部 assistant 时补齐角色交替", () => {
  function makeHost(input: { lastMessage: LlmMessage | null; now: Date }) {
    const appendMessages = vi.fn(async (_messages: LlmMessage[]) => {});
    const getLastMessage = vi.fn(async () => input.lastMessage);

    const host = new RootAgentHost({
      context: { appendMessages, getLastMessage },
      eventQueue: {},
      session: {},
      interpreter: {},
      // 固定 now → 两次调用落在同一个 wake-reminder bucket，隔离出「尾部是否 assistant」这一个变量。
      now: () => input.now,
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    return { host, appendMessages, getLastMessage };
  }

  const FIXED_NOW = new Date("2026-07-24T10:00:00+08:00");

  it("尾部是 assistant：同一 bucket 内仍无条件补一条 wake-reminder（防连续 assistant → 400）", async () => {
    const assistantTail: LlmMessage = {
      role: "assistant",
      content: "这轮我没什么要做的。",
      toolCalls: [],
    };
    const { host, appendMessages } = makeHost({ lastMessage: assistantTail, now: FIXED_NOW });

    // 第一次：lastWakeReminderAt 为 null，本就会补；把 bucket 钉在 FIXED_NOW。
    await host.appendWakeReminderIfNeeded();
    expect(appendMessages).toHaveBeenCalledTimes(1);

    // 第二次：同一 bucket，但尾部仍是 assistant → 必须再补，否则下一轮纯文本会连续 assistant。
    await host.appendWakeReminderIfNeeded();
    expect(appendMessages).toHaveBeenCalledTimes(2);
    const secondCallArg = appendMessages.mock.calls[1][0];
    expect(secondCallArg[0]?.role).toBe("user");
  });

  it("尾部非 assistant：同一 bucket 内不重复补（保持既有 30min 节流）", async () => {
    const toolTail: LlmMessage = { role: "tool", toolCallId: "tc1", content: "{}" };
    const { host, appendMessages } = makeHost({ lastMessage: toolTail, now: FIXED_NOW });

    // 第一次：钉 bucket。
    await host.appendWakeReminderIfNeeded();
    expect(appendMessages).toHaveBeenCalledTimes(1);

    // 第二次：同一 bucket 且尾部不是 assistant → 走 30min 节流，不再补。
    await host.appendWakeReminderIfNeeded();
    expect(appendMessages).toHaveBeenCalledTimes(1);
  });

  it("空上下文（getLastMessage 返回 null）：视同非 assistant，走节流", async () => {
    const { host, appendMessages } = makeHost({ lastMessage: null, now: FIXED_NOW });

    await host.appendWakeReminderIfNeeded();
    await host.appendWakeReminderIfNeeded();
    expect(appendMessages).toHaveBeenCalledTimes(1);
  });
});
