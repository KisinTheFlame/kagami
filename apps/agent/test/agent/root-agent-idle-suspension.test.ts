import { describe, expect, it, vi } from "vitest";
import { InMemoryQueue } from "@kagami/agent-runtime";
import { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10));

/**
 * toolChoice auto 的防空转契约（issue #268，2026-05-30 用量暴涨事故的形状）：
 *
 * 模型某轮零工具调用（纯文本轮）时，主循环必须挂起在事件队列上，直到新事件
 * 入队才起下一轮 LLM 调用。没有这个挂起，BaseLoopAgent 的 while 会立即用几乎
 * 相同的上下文再打一轮 LLM，空转刷轮次。
 */
describe("RootLoopAgent — 纯文本轮挂起直到新事件", () => {
  function makeAgent() {
    const chat = vi.fn().mockResolvedValue({
      provider: "claude-code",
      model: "claude-opus-4-6",
      message: { role: "assistant", content: "这轮不需要动作。", toolCalls: [] },
    });
    const eventQueue = new InMemoryQueue<{ type: string }>() as unknown as AgentEventQueue;
    const consumedEvents: unknown[] = [];

    const agent = new RootLoopAgent({
      llmClient: {
        chat,
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context: {
        getSnapshot: async () => ({ systemPrompt: "sys", messages: [] }),
        appendAssistantTurn: vi.fn(async () => {}),
        appendToolResult: vi.fn(async () => {}),
        appendMessages: vi.fn(async () => {}),
      },
      eventQueue,
      session: {
        initializeContext: vi.fn(async () => {}),
        consumeIncomingEvent: vi.fn(async (event: unknown) => {
          consumedEvents.push(event);
        }),
        flushPendingIncomingEffects: vi.fn(async () => ({ shouldTriggerRound: false })),
        flushPendingPostToolEffects: vi.fn(async () => ({ messages: [], events: [] })),
      },
      tools: {
        definitions: () => [],
        getKind: () => "business",
        execute: async () => ({ content: "", kind: "business" }),
      },
      sleep: async () => {},
    } as unknown as ConstructorParameters<typeof RootLoopAgent>[0]);

    return { agent, chat, eventQueue };
  }

  it("零 toolCall 轮后不再自发起新轮；新事件入队才恢复", async () => {
    const { agent, chat, eventQueue } = makeAgent();
    const runPromise = agent.run();

    // 第一轮：纯文本轮跑完后挂起。
    await tick();
    expect(chat).toHaveBeenCalledTimes(1);

    // 无事件期间不空转：多等几拍仍只有一次 LLM 调用。
    await tick();
    await tick();
    expect(chat).toHaveBeenCalledTimes(1);

    // 新事件入队 → 解除挂起 → 起下一轮。
    eventQueue.enqueue({ type: "wake" });
    await tick();
    expect(chat).toHaveBeenCalledTimes(2);

    await agent.stop();
    await runPromise;
  });
});
