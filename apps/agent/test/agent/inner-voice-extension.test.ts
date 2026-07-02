import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { InnerVoiceExtension } from "../../src/agent/runtime/root-agent/extensions/inner-voice.extension.js";
import { InnerVoiceIdleTracker } from "../../src/agent/capabilities/inner-voice/domain/idle-tracker.js";
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
  for (let i = 0; i < 6; i++) {
    tracker.recordToolCall("wait", new Date(NOW.getTime() - (5 + i * 5) * 60_000));
  }
  return tracker;
}

function createHarness(input: {
  tracker: InnerVoiceIdleTracker;
  thought: string | null;
  operationError?: Error;
}): {
  extension: InnerVoiceExtension;
  enqueue: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  context: RootLoopExtensionContext;
} {
  const enqueue = vi.fn();
  const execute = input.operationError
    ? vi.fn().mockRejectedValue(input.operationError)
    : vi.fn().mockResolvedValue({ thought: input.thought });
  const extension = new InnerVoiceExtension({
    tracker: input.tracker,
    operation: { execute },
    eventQueue: { enqueue } as unknown as AgentEventQueue,
    now: () => NOW,
  });
  const context = {
    host: {
      getContextSnapshot: vi
        .fn()
        .mockResolvedValue({ systemPrompt: "persona", messages: [{ role: "user", content: "m" }] }),
    },
  } as unknown as RootLoopExtensionContext;
  return { extension, enqueue, execute, context };
}

function waitRound(): {
  toolExecutions: readonly { toolCall: { name: string; arguments: Record<string, unknown> } }[];
} {
  return { toolExecutions: [{ toolCall: { name: "wait", arguments: {} } }] };
}

describe("InnerVoiceExtension", () => {
  it("摸鱼成立且产出念头 → enqueue inner_thought 事件", async () => {
    const { extension, enqueue, execute, context } = createHarness({
      tracker: trackerAboutToTrigger(),
      thought: "想翻翻那篇文章",
    });

    await extension.onAfterCommit({ context, result: waitRound() });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      type: "inner_thought",
      data: { thought: "想翻翻那篇文章" },
    });
  });

  it("空念头 → 不 enqueue，但配额已被消耗（防连环空转）", async () => {
    const tracker = trackerAboutToTrigger();
    const { extension, enqueue, context } = createHarness({ tracker, thought: null });

    await extension.onAfterCommit({ context, result: waitRound() });
    expect(enqueue).not.toHaveBeenCalled();
    // 紧接着的下一轮不会再次触发（不应期生效）。
    expect(tracker.shouldTrigger(new Date(NOW.getTime() + 60_000))).toBe(false);
  });

  it("摸鱼不成立 → 完全不跑 operation", async () => {
    const { extension, execute, context } = createHarness({
      tracker: new InnerVoiceIdleTracker(),
      thought: "x",
    });
    await extension.onAfterCommit({ context, result: waitRound() });
    expect(execute).not.toHaveBeenCalled();
  });

  it("本轮的投入型调用先入账再判定——刚干完活不算摸鱼", async () => {
    const { extension, execute, context } = createHarness({
      tracker: trackerAboutToTrigger(),
      thought: "x",
    });
    await extension.onAfterCommit({
      context,
      result: {
        toolExecutions: [{ toolCall: { name: "invoke", arguments: { tool: "glance_hn" } } }],
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("operation 抛错被吞掉，不拖垮主循环", async () => {
    const { extension, enqueue, context } = createHarness({
      tracker: trackerAboutToTrigger(),
      thought: null,
      operationError: new Error("boom"),
    });
    await expect(
      extension.onAfterCommit({ context, result: waitRound() }),
    ).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
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
