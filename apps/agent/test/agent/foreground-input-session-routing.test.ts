import { describe, expect, it, vi } from "vitest";
import { AppManager, InMemoryQueue, type App } from "@kagami/agent-runtime";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import {
  isForegroundInputSource,
  type ForegroundInput,
} from "../../src/agent/runtime/root-agent/foreground-input.js";
import type { Event } from "../../src/agent/runtime/event/event.js";
import type { RecordMetricInput } from "../../src/metric/application/metric.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

/** 假 App：实现 ForegroundInputSource，drain 行为由测试注入。 */
function createForegroundApp(
  id: string,
  drain: () => Promise<ForegroundInput | null>,
): App & { drainForegroundInput: () => Promise<ForegroundInput | null> } {
  return {
    id,
    displayName: id,
    tools: [],
    canInvoke: () => true,
    help: async () => "",
    drainForegroundInput: drain,
  };
}

function createPlainApp(id: string): App {
  return { id, displayName: id, tools: [], canInvoke: () => true, help: async () => "" };
}

function createSession(apps: App[], metrics?: RecordMetricInput[]) {
  const context = new DefaultAgentContext({ systemPromptFactory: () => "system-prompt" });
  const appManager = new AppManager();
  for (const app of apps) {
    appManager.register(app);
  }
  const session = new RootAgentSession({
    context,
    appManager,
    metricService: {
      record: async input => {
        metrics?.push(input);
      },
    },
  });
  return { context, session };
}

describe("foreground_input session 路由（前台输入敲门 → 当前 App 现拉）", () => {
  it("向实现了 ForegroundInputSource 的当前 App 拉取并注入尾部", async () => {
    const app = createForegroundApp("fake", async () => ({
      text: "<fake_screen>你好</fake_screen>",
      itemCount: 2,
    }));
    const metrics: RecordMetricInput[] = [];
    const { context, session } = createSession([app], metrics);
    session.setCurrentApp("fake");

    const consumed = await session.consumeIncomingEvent({ type: "foreground_input" });
    const flushed = await session.flushPendingIncomingEffects();

    expect(consumed).toEqual({ shouldTriggerRound: true });
    expect(flushed).toEqual({ shouldTriggerRound: true });
    const snapshot = await context.getSnapshot();
    const injected = snapshot.messages.at(-1);
    // 薄包装：App 渲染好的伪标签文本原样成为 user message，不套第二层标签。
    expect(injected).toMatchObject({ role: "user", content: "<fake_screen>你好</fake_screen>" });
    expect(metrics).toContainEqual(
      expect.objectContaining({ metricName: "agent.foreground.inject", value: 2 }),
    );
  });

  it("多次敲门幂等：首次拉全量，后续拉空 no-op", async () => {
    let buffered: ForegroundInput | null = {
      text: "<fake_screen>a\nb\nc</fake_screen>",
      itemCount: 3,
    };
    const app = createForegroundApp("fake", async () => {
      const drained = buffered;
      buffered = null;
      return drained;
    });
    const { context, session } = createSession([app]);
    session.setCurrentApp("fake");

    // 3 条消息 = 3 个敲门事件，第一次消费全部游标增量。
    const first = await session.consumeIncomingEvent({ type: "foreground_input" });
    const second = await session.consumeIncomingEvent({ type: "foreground_input" });
    const third = await session.consumeIncomingEvent({ type: "foreground_input" });
    await session.flushPendingIncomingEffects();

    expect(first).toEqual({ shouldTriggerRound: true });
    expect(second).toEqual({ shouldTriggerRound: false });
    expect(third).toEqual({ shouldTriggerRound: false });
    const snapshot = await context.getSnapshot();
    const injectedCount = snapshot.messages.filter(
      message => typeof message.content === "string" && message.content.includes("<fake_screen>"),
    ).length;
    expect(injectedCount).toBe(1);
  });

  it("当前 App 未实现前台输入能力时 no-op（type guard 挡住）", async () => {
    const metrics: RecordMetricInput[] = [];
    const { session } = createSession([createPlainApp("plain")], metrics);
    session.setCurrentApp("plain");

    const consumed = await session.consumeIncomingEvent({ type: "foreground_input" });

    expect(consumed).toEqual({ shouldTriggerRound: false });
    expect(metrics).toContainEqual(
      expect.objectContaining({ metricName: "agent.foreground.drain_empty" }),
    );
  });

  it("无当前 App（Portal / reset 后）时 no-op", async () => {
    const { session } = createSession([]);
    const consumed = await session.consumeIncomingEvent({ type: "foreground_input" });
    expect(consumed).toEqual({ shouldTriggerRound: false });
  });

  it("App 返回空文本时视同拉空 no-op", async () => {
    const app = createForegroundApp("empty", async () => ({ text: "", itemCount: 0 }));
    const metrics: RecordMetricInput[] = [];
    const { session } = createSession([app], metrics);
    session.setCurrentApp("empty");

    const consumed = await session.consumeIncomingEvent({ type: "foreground_input" });

    expect(consumed).toEqual({ shouldTriggerRound: false });
    expect(metrics).toContainEqual(
      expect.objectContaining({ metricName: "agent.foreground.drain_empty" }),
    );
  });

  it("metric record 拒绝时不影响 foreground_input 消费（fire-and-forget）", async () => {
    const app = createForegroundApp("fake", async () => ({ text: "<t>x</t>", itemCount: 1 }));
    const context = new DefaultAgentContext({ systemPromptFactory: () => "s" });
    const appManager = new AppManager();
    appManager.register(app);
    const session = new RootAgentSession({
      context,
      appManager,
      metricService: {
        record: async () => {
          throw new Error("metric 挂了");
        },
      },
    });
    session.setCurrentApp("fake");

    await expect(session.consumeIncomingEvent({ type: "foreground_input" })).resolves.toEqual({
      shouldTriggerRound: true,
    });
  });

  it("App drain 抛错时视同拉空，不打崩主循环路径", async () => {
    const app = createForegroundApp("boom", async () => {
      throw new Error("模板渲染炸了");
    });
    const metrics: RecordMetricInput[] = [];
    const { session } = createSession([app], metrics);
    session.setCurrentApp("boom");

    const consumed = await session.consumeIncomingEvent({ type: "foreground_input" });

    expect(consumed).toEqual({ shouldTriggerRound: false });
    expect(metrics).toContainEqual(
      expect.objectContaining({ metricName: "agent.foreground.drain_empty" }),
    );
  });

  it("敲门事件能唤醒阻塞在 waitNonEmpty 上的消费者（wake-up generality）", async () => {
    const queue = new InMemoryQueue<Event>();
    let woken = false;
    const waiting = queue.waitNonEmpty().then(() => {
      woken = true;
    });

    queue.enqueue({ type: "foreground_input" });
    await waiting;

    expect(woken).toBe(true);
    expect(queue.dequeue()).toEqual({ type: "foreground_input" });
  });
});

describe("blurCurrentApp（reset 前失焦广播）", () => {
  it("调用当前 App 的 onBlur 并丢弃其 effects", async () => {
    const onBlur = vi.fn(async () => []);
    const app: App = { ...createPlainApp("qq"), onBlur };
    const { session } = createSession([app]);
    session.setCurrentApp("qq");

    await session.blurCurrentApp();

    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("onBlur 抛错被吞掉，不阻断 reset 流程", async () => {
    const app: App = {
      ...createPlainApp("qq"),
      onBlur: async () => {
        throw new Error("退化补推炸了");
      },
    };
    const { session } = createSession([app]);
    session.setCurrentApp("qq");

    await expect(session.blurCurrentApp()).resolves.toBeUndefined();
  });

  it("无当前 App 或 App 无 onBlur 时 no-op", async () => {
    const { session } = createSession([createPlainApp("plain")]);
    await expect(session.blurCurrentApp()).resolves.toBeUndefined();
    session.setCurrentApp("plain");
    await expect(session.blurCurrentApp()).resolves.toBeUndefined();
  });
});

describe("isForegroundInputSource", () => {
  it("按方法存在性判定，不看类型标称", () => {
    expect(isForegroundInputSource({ drainForegroundInput: async () => null })).toBe(true);
    expect(isForegroundInputSource({})).toBe(false);
    expect(isForegroundInputSource(null)).toBe(false);
    expect(isForegroundInputSource("qq")).toBe(false);
  });
});
