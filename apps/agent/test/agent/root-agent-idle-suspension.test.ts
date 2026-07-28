import { describe, expect, it, vi } from "vitest";
import { InMemoryQueue } from "@kagami/agent-runtime";
import { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { AlertNotifier } from "../../src/agent/runtime/root-agent/alert-notifier.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10));

/**
 * toolChoice auto 的防空转契约。**本文件的语义在 issue #602 被有意反转过，别照旧读。**
 *
 * 原契约（#268，2026-05-30 用量暴涨事故的形状）：模型某轮零工具调用就**立刻**挂起，直到新事件
 * 入队才起下一轮。没有这个挂起，BaseLoopAgent 的 while 会立即用几乎相同的上下文再打一轮 LLM，
 * 空转刷轮次。
 *
 * 现契约（#602）：粒度太粗——她吐一个空 content 就睡 10 分钟，外面看就是「卡死」，而且没有任何人
 * 被通知。改成分级：空轮 / 纯文本轮各自允许**连续跑到阈值**（默认 4）才挂起，并在挂起时告警。
 * 闸没有被拆掉，只是从「1 轮」放宽到「最多 N 轮」——有 tool call 就归零 + 硬上限，仍然有界，
 * 不会回到无界空转。代价是无动作轮的 LLM 调用最坏放大 N 倍。
 */
const TEXT_ONLY_RESPONSE = {
  provider: "claude-code",
  model: "claude-opus-4-6",
  message: { role: "assistant", content: "这轮不需要动作。", toolCalls: [] },
};
const EMPTY_RESPONSE = {
  provider: "claude-code",
  model: "claude-opus-4-6",
  message: { role: "assistant", content: "", toolCalls: [] },
};
const ACTED_RESPONSE = {
  provider: "claude-code",
  model: "claude-opus-4-6",
  message: {
    role: "assistant",
    content: "看一眼列表。",
    toolCalls: [{ id: "tc1", name: "invoke", arguments: {} }],
  },
};

describe("RootLoopAgent — 无动作轮连击到阈值才挂起并告警", () => {
  function makeAgent(options: { idleWakeMaxWaitMs?: number; stallThreshold?: number } = {}) {
    const chat = vi.fn().mockResolvedValue(TEXT_ONLY_RESPONSE);
    const raise = vi.fn<AlertNotifier["raise"]>(async () => {});
    const rawQueue = new InMemoryQueue<{ type: string }>();
    const eventQueue = rawQueue as unknown as AgentEventQueue;
    const consumedEvents: unknown[] = [];

    const agent = new RootLoopAgent({
      llmClient: {
        chat,
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context: {
        getSnapshot: async () => ({ systemPrompt: "sys", messages: [] }),
        getLastMessage: vi.fn(async () => null),
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
        // 无动作轮隐式挂起路径会调 setSuspended 置位状态供采样归 "wait" 桶。
        setSuspended: vi.fn(),
      },
      tools: {
        definitions: () => [],
        getKind: () => "business",
        execute: async () => ({ content: "", kind: "business" }),
      },
      alertNotifier: { raise },
      sleep: async () => {},
      ...(options.idleWakeMaxWaitMs !== undefined
        ? { idleWakeMaxWaitMs: options.idleWakeMaxWaitMs }
        : {}),
      ...(options.stallThreshold !== undefined ? { stallThreshold: options.stallThreshold } : {}),
    } as unknown as ConstructorParameters<typeof RootLoopAgent>[0]);

    return { agent, chat, raise, eventQueue, rawQueue };
  }

  it("纯文本轮：前 3 轮不挂起、连打 4 次 LLM，第 4 轮才挂起并告警 no_tool_stall", async () => {
    const { agent, chat, raise } = makeAgent();
    const runPromise = agent.run();

    // 连续跑到阈值：4 次 LLM 调用后挂起（旧契约这里只会有 1 次）。
    await tick();
    await tick();
    expect(chat).toHaveBeenCalledTimes(4);

    // 挂起后不再空转。
    await tick();
    await tick();
    expect(chat).toHaveBeenCalledTimes(4);

    expect(raise).toHaveBeenCalledTimes(1);
    const alert = raise.mock.calls[0]![0];
    expect(alert.event).toBe("react.no_tool_stall");
    expect(alert.severity).toBe("error");
    expect(alert.source).toBe("agent");
    expect(alert.context).toMatchObject({ noToolStreak: 4 });

    await agent.stop();
    await runPromise;
  });

  it("空轮：同样连跑到阈值，告警是更具体的 empty_stall", async () => {
    const { agent, chat, raise } = makeAgent();
    chat.mockResolvedValue(EMPTY_RESPONSE);
    const runPromise = agent.run();

    await tick();
    await tick();
    expect(chat).toHaveBeenCalledTimes(4);

    expect(raise).toHaveBeenCalledTimes(1);
    const alert = raise.mock.calls[0]![0];
    expect(alert.event).toBe("react.empty_stall");
    expect(alert.context).toMatchObject({ emptyStreak: 4, noToolStreak: 4 });

    await agent.stop();
    await runPromise;
  });

  it("混合链 text,empty,empty,empty：报 no_tool_stall（不是 empty_stall）", async () => {
    const { agent, chat, raise } = makeAgent();
    chat
      .mockResolvedValueOnce(TEXT_ONLY_RESPONSE)
      .mockResolvedValueOnce(EMPTY_RESPONSE)
      .mockResolvedValueOnce(EMPTY_RESPONSE)
      .mockResolvedValue(EMPTY_RESPONSE);
    const runPromise = agent.run();

    await tick();
    await tick();

    expect(raise).toHaveBeenCalledTimes(1);
    const alert = raise.mock.calls[0]![0];
    expect(alert.event).toBe("react.no_tool_stall");
    expect(alert.context).toMatchObject({ emptyStreak: 3, noToolStreak: 4 });

    await agent.stop();
    await runPromise;
  });

  it("链中出现 tool call 就归零：3 连无动作 + 1 次动作后，还得再攒 4 轮才告警", async () => {
    const { agent, chat, raise } = makeAgent();
    chat
      .mockResolvedValueOnce(TEXT_ONLY_RESPONSE)
      .mockResolvedValueOnce(TEXT_ONLY_RESPONSE)
      .mockResolvedValueOnce(TEXT_ONLY_RESPONSE)
      .mockResolvedValueOnce(ACTED_RESPONSE)
      .mockResolvedValueOnce(TEXT_ONLY_RESPONSE)
      .mockResolvedValueOnce(TEXT_ONLY_RESPONSE)
      .mockResolvedValue(TEXT_ONLY_RESPONSE);
    const runPromise = agent.run();

    await tick();
    await tick();

    // 3 轮无动作 + 1 轮动作（把两个计数器归零）+ 重新攒满 4 轮 = 8 次 LLM 调用才告警一次。
    expect(chat).toHaveBeenCalledTimes(8);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0]![0].context).toMatchObject({
      noToolStreak: 4,
    });

    await agent.stop();
    await runPromise;
  });

  it("告警挂起后被事件唤醒，紧接着的那一轮不会立刻再告警（计数器已归零）", async () => {
    const { agent, chat, raise, eventQueue } = makeAgent();
    const runPromise = agent.run();

    await tick();
    await tick();
    expect(chat).toHaveBeenCalledTimes(4);
    expect(raise).toHaveBeenCalledTimes(1);

    // 逐轮步进：让唤醒后的第一轮 LLM 悬停，这样能精确观察「刚醒来的那一轮」而不是「一个 tick
    // 里能跑完的若干轮」——后者会攒满新的 4 连并如实再告警一次（那是正确行为，不是缺陷）。
    let releaseRound!: (value: unknown) => void;
    chat.mockImplementationOnce(() => new Promise(resolve => (releaseRound = resolve)));

    eventQueue.enqueue({ type: "wake" });
    await tick();

    // 唤醒后的第 5 轮已起（第 5 次 chat 调用在飞），而告警仍只有第 4 轮那一条——这就是要验的
    // 性质：计数器已归零，新一段连击从 1 开始，不会「刚醒就再响」。
    expect(chat).toHaveBeenCalledTimes(5);
    expect(raise).toHaveBeenCalledTimes(1);

    // 放掉悬停的那一轮让循环能收尾；不再往后跑（继续跑会攒满新的 4 连并如实再告警一次，
    // 那由下一个用例覆盖）。
    releaseRound(TEXT_ONLY_RESPONSE);
    await agent.stop();
    await runPromise;
  });

  it("醒来后若继续不动手，攒满新的 4 连会如实再告警一次（不是压制，是分段计数）", async () => {
    const { agent, chat, raise, eventQueue } = makeAgent();
    const runPromise = agent.run();

    await tick();
    await tick();
    expect(raise).toHaveBeenCalledTimes(1);

    eventQueue.enqueue({ type: "wake" });
    await tick();
    await tick();

    expect(chat).toHaveBeenCalledTimes(8);
    expect(raise).toHaveBeenCalledTimes(2);

    await agent.stop();
    await runPromise;
  });

  it("告警通道抛错不拖垮主循环：照常挂起、不崩", async () => {
    const { agent, chat, raise } = makeAgent();
    raise.mockRejectedValue(new Error("observatory down"));
    const runPromise = agent.run();

    await tick();
    await tick();
    expect(chat).toHaveBeenCalledTimes(4);
    expect(raise).toHaveBeenCalledTimes(1);

    // 挂起仍然生效（没有因为告警失败而继续空转）。
    await tick();
    expect(chat).toHaveBeenCalledTimes(4);

    await agent.stop();
    await runPromise;
  });

  it("阈值可注入：threshold=1 时第一轮无动作即挂起（回归旧 #268 行为）", async () => {
    const { agent, chat, raise } = makeAgent({ stallThreshold: 1 });
    const runPromise = agent.run();

    await tick();
    expect(chat).toHaveBeenCalledTimes(1);
    await tick();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledTimes(1);

    await agent.stop();
    await runPromise;
  });

  it("自唤醒兜底：无外部事件时到 idleWakeMaxWaitMs 也会自己醒来（#268 契约保留）", async () => {
    const { agent, chat } = makeAgent({ idleWakeMaxWaitMs: 20, stallThreshold: 1 });
    const runPromise = agent.run();

    await tick();
    expect(chat).toHaveBeenCalledTimes(1);

    // 不注入任何外部事件，等超过自唤醒上限：timer 注入 wake，应再起一轮。
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(chat.mock.calls.length).toBeGreaterThanOrEqual(2);

    await agent.stop();
    await runPromise;
  });

  it("stop 的 wake 被同轮 drain 吃掉也不死锁（stopRequested 先行复查，#268 契约保留）", async () => {
    const { agent, chat, rawQueue } = makeAgent({ stallThreshold: 1 });
    let resolveChat!: (value: unknown) => void;
    chat.mockImplementationOnce(() => new Promise(resolve => (resolveChat = resolve)));

    const runPromise = agent.run();
    await tick(); // 第一轮 LLM 调用在飞

    // 在轮次进行中 stop：flag 置位 + wake 入队；随后模拟该 wake 已被消费
    //（真实场景：wake 恰好被同一次迭代 step-1 的 consumePendingEvents 吃掉）。
    const stopPromise = agent.stop();
    rawQueue.clear();
    resolveChat(TEXT_ONLY_RESPONSE);

    // 修复前：挂起阻塞在空队列上，stop 永不返回（关停死锁）。
    await expect(
      Promise.race([
        stopPromise.then(() => "stopped"),
        new Promise(resolve => setTimeout(() => resolve("timeout"), 500)),
      ]),
    ).resolves.toBe("stopped");
    await runPromise;
  });
});
