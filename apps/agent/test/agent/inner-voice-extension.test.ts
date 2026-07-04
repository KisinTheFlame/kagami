import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  InnerVoiceExtension,
  INNER_VOICE_METRIC_EMPTY,
  INNER_VOICE_METRIC_FAILED,
  INNER_VOICE_METRIC_INJECTED,
  INNER_VOICE_METRIC_TRIGGERED,
} from "../../src/agent/runtime/root-agent/extensions/inner-voice.extension.js";
import { InnerVoiceIdleTracker } from "../../src/agent/capabilities/inner-voice/domain/idle-tracker.js";
import type { MetricClient } from "@kagami/metric-client/client";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { createInnerThoughtMessage } from "../../src/agent/runtime/context/context-message-factory.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { AgentContext } from "../../src/agent/runtime/context/agent-context.js";
import type { RootLoopExtensionContext } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

beforeAll(() => {
  initTestLoggerRuntime();
});

// Beijing 14:00 → UTC 06:00：落在时段窗内。
const NOW = new Date("2026-07-02T06:00:00Z");

function trackerAboutToTrigger(): InnerVoiceIdleTracker {
  const tracker = new InnerVoiceIdleTracker();
  // 30min 窗内 3 个 wait 即达标（5/10/15 分钟前）。
  for (let i = 0; i < 3; i++) {
    tracker.recordWait(new Date(NOW.getTime() - (5 + i * 5) * 60_000));
  }
  return tracker;
}

const RUNTIME_KEY = "root-agent";

function createHarness(input: {
  tracker: InnerVoiceIdleTracker;
  thought: string | null;
  operationError?: Error;
  daoError?: Error;
}): {
  extension: InnerVoiceExtension;
  enqueue: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  metrics: string[];
  context: RootLoopExtensionContext;
} {
  const enqueue = vi.fn();
  const execute = input.operationError
    ? vi.fn().mockRejectedValue(input.operationError)
    : vi.fn().mockResolvedValue({ thought: input.thought });
  const insert = input.daoError
    ? vi.fn().mockRejectedValue(input.daoError)
    : vi.fn().mockResolvedValue(undefined);
  const metrics: string[] = [];
  const metricService: MetricClient = {
    record: async ({ metricName }) => {
      metrics.push(metricName);
    },
  };
  const extension = new InnerVoiceExtension({
    tracker: input.tracker,
    operation: { execute },
    eventQueue: { enqueue } as unknown as AgentEventQueue,
    metricService,
    innerThoughtDao: { insert },
    runtimeKey: RUNTIME_KEY,
    now: () => NOW,
  });
  const context = {
    host: {
      getContextSnapshot: vi
        .fn()
        .mockResolvedValue({ systemPrompt: "persona", messages: [{ role: "user", content: "m" }] }),
    },
  } as unknown as RootLoopExtensionContext;
  return { extension, enqueue, execute, insert, metrics, context };
}

type OnAfterCommitInput = Parameters<InnerVoiceExtension["onAfterCommit"]>[0];

/** onAfterCommit 只读 result.toolExecutions[].toolCall；构造最小 round 结果并断言到完整类型。 */
function round(
  toolNames: { name: string; args?: Record<string, unknown> }[],
): OnAfterCommitInput["result"] {
  return {
    toolExecutions: toolNames.map(t => ({ toolCall: { name: t.name, arguments: t.args ?? {} } })),
  } as unknown as OnAfterCommitInput["result"];
}

function waitRound(): OnAfterCommitInput["result"] {
  return round([{ name: "wait" }]);
}

describe("InnerVoiceExtension", () => {
  it("摸鱼成立且产出念头 → enqueue inner_thought 事件 + triggered/injected metric + 落 injected 行", async () => {
    const { extension, enqueue, execute, insert, metrics, context } = createHarness({
      tracker: trackerAboutToTrigger(),
      thought: "想翻翻那篇文章",
    });

    await extension.onAfterCommit({ context, result: waitRound() });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      type: "inner_thought",
      data: { thought: "想翻翻那篇文章" },
    });
    expect(metrics).toEqual([INNER_VOICE_METRIC_TRIGGERED, INNER_VOICE_METRIC_INJECTED]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      triggeredAt: NOW,
      outcome: "injected",
      thought: "想翻翻那篇文章",
      runtimeKey: RUNTIME_KEY,
    });
  });

  it("空念头 → 不 enqueue，配额已消耗，打 triggered/empty metric + 落 empty 空行", async () => {
    const tracker = trackerAboutToTrigger();
    const { extension, enqueue, insert, metrics, context } = createHarness({
      tracker,
      thought: null,
    });

    await extension.onAfterCommit({ context, result: waitRound() });
    expect(enqueue).not.toHaveBeenCalled();
    expect(metrics).toEqual([INNER_VOICE_METRIC_TRIGGERED, INNER_VOICE_METRIC_EMPTY]);
    expect(insert).toHaveBeenCalledWith({
      triggeredAt: NOW,
      outcome: "empty",
      thought: "",
      runtimeKey: RUNTIME_KEY,
    });
    // 紧接着的下一轮不会再次触发（不应期生效）。
    expect(tracker.shouldTrigger(new Date(NOW.getTime() + 60_000))).toBe(false);
  });

  it("摸鱼不成立 → 完全不跑 operation、不打 metric、不落行", async () => {
    const { extension, execute, insert, metrics, context } = createHarness({
      tracker: new InnerVoiceIdleTracker(),
      thought: "x",
    });
    await extension.onAfterCommit({ context, result: waitRound() });
    expect(execute).not.toHaveBeenCalled();
    expect(metrics).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("非 wait 调用不推进摸鱼判定（wait 才计数）", async () => {
    const { extension, execute, context } = createHarness({
      tracker: new InnerVoiceIdleTracker(),
      thought: "x",
    });
    // 一轮 3 个 invoke 不等于 3 个 wait —— 判定不成立。
    await extension.onAfterCommit({
      context,
      result: round([
        { name: "invoke", args: { tool: "glance_hn" } },
        { name: "invoke", args: { tool: "search_hn" } },
        { name: "invoke", args: { tool: "open_ithome_article" } },
      ]),
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("operation 抛错被吞掉，不拖垮主循环，打 triggered/failed metric + 落 failed 空行", async () => {
    const { extension, enqueue, insert, metrics, context } = createHarness({
      tracker: trackerAboutToTrigger(),
      thought: null,
      operationError: new Error("boom"),
    });
    await expect(
      extension.onAfterCommit({ context, result: waitRound() }),
    ).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
    expect(metrics).toEqual([INNER_VOICE_METRIC_TRIGGERED, INNER_VOICE_METRIC_FAILED]);
    expect(insert).toHaveBeenCalledWith({
      triggeredAt: NOW,
      outcome: "failed",
      thought: "",
      runtimeKey: RUNTIME_KEY,
    });
  });

  it("落库抛错被吞掉，不拖垮主循环，念头仍照常注入", async () => {
    const { extension, enqueue, insert, context } = createHarness({
      tracker: trackerAboutToTrigger(),
      thought: "想翻翻那篇文章",
      daoError: new Error("db down"),
    });
    await expect(
      extension.onAfterCommit({ context, result: waitRound() }),
    ).resolves.toBeUndefined();
    // 落库失败不影响念头进上下文（enqueue 在 insert 之前，且 insert 异常被 best-effort 吞掉）。
    expect(enqueue).toHaveBeenCalledWith({
      type: "inner_thought",
      data: { thought: "想翻翻那篇文章" },
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("inner_thought 事件的 session 路由", () => {
  it("装配成 <inner_thought> 消息追加尾部并触发一轮", async () => {
    const appended: unknown[] = [];
    const context = {
      appendMessages: vi.fn(async (messages: unknown[]) => {
        appended.push(...messages);
      }),
    } as unknown as AgentContext;
    const session = new RootAgentSession({ context });

    const routed = await session.consumeIncomingEvent({
      type: "inner_thought",
      data: { thought: "想翻翻那篇文章" },
    });
    expect(routed.shouldTriggerRound).toBe(true);

    const flushed = await session.flushPendingIncomingEffects();
    expect(flushed.shouldTriggerRound).toBe(true);
    // initializeContext 会先追加 portal reminder，inner_thought 在其后。
    expect(appended.at(-1)).toEqual(createInnerThoughtMessage("想翻翻那篇文章"));
  });
});

describe("inner-voice 进上下文文案的义务口吻禁令（issue #265 验收判据 5）", () => {
  const staticDir = join(dirname(fileURLToPath(import.meta.url)), "../../static");
  const bannedTokens = ["请", "尽快", "建议", "应该", "需要你", "记得", "去做"];

  for (const file of ["context/inner-thought.hbs", "context/inner-voice-instruction.hbs"]) {
    it(`${file} 不含禁词`, () => {
      const content = readFileSync(join(staticDir, file), "utf8");
      for (const token of bannedTokens) {
        expect(content.includes(token), `禁词「${token}」出现在 ${file}`).toBe(false);
      }
    });
  }

  it("指令模板保留「不行动合法」的台阶", () => {
    const content = readFileSync(join(staticDir, "context/inner-voice-instruction.hbs"), "utf8");
    expect(content).toContain("没什么真想做的就是没有");
  });

  it("inner_thought 消息只是念头的伪标签壳", () => {
    const { content } = createInnerThoughtMessage(" 想翻翻那篇文章 ");
    expect(typeof content).toBe("string");
    expect(String(content).trimEnd()).toBe("<inner_thought>想翻翻那篇文章</inner_thought>");
  });
});
