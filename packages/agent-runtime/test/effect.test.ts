import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@kagami/llm";
import type {
  Effect,
  EffectHandler,
  ReplaceLeadingMessagesEffect,
  ReplaceLeadingMessagesTarget,
} from "../src/effect.js";
import {
  HandlerEffectInterpreter,
  NoopEffectInterpreter,
  REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
  ReplaceLeadingMessagesHandler,
} from "../src/effect.js";

function userMessage(text: string): LlmMessage {
  return { role: "user", content: text };
}

function recordingHandler(
  type: string,
  output: { appended?: LlmMessage[]; control?: string } = {},
): EffectHandler<string> & { calls: Effect[] } {
  const calls: Effect[] = [];
  return {
    calls,
    matches(effect) {
      return effect.type === type;
    },
    async handle(effect) {
      calls.push(effect);
      const result: { appendedMessages?: LlmMessage[]; control?: string } = {};
      if (output.appended) {
        result.appendedMessages = output.appended;
      }
      if (output.control !== undefined) {
        result.control = output.control;
      }
      return result;
    },
  };
}

describe("NoopEffectInterpreter", () => {
  it("接收空 effect 列表时返回空 appendedMessages", async () => {
    await expect(new NoopEffectInterpreter().apply([])).resolves.toEqual({
      appendedMessages: [],
    });
  });

  it("收到任何 effect 都抛错——绝不静默吞掉", async () => {
    await expect(new NoopEffectInterpreter().apply([{ type: "switch_app" }])).rejects.toThrow(
      /received effects/,
    );
  });
});

describe("HandlerEffectInterpreter", () => {
  it("每个 effect 路由到第一个 matches 的 handler", async () => {
    const first = recordingHandler("a");
    const second = recordingHandler("a");
    const interpreter = new HandlerEffectInterpreter<string>([first, second]);

    await interpreter.apply([{ type: "a" }]);

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  it("没有 handler 匹配时抛错——不静默丢弃 effect", async () => {
    const interpreter = new HandlerEffectInterpreter<string>([recordingHandler("a")]);

    await expect(interpreter.apply([{ type: "unhandled" }])).rejects.toThrow(
      /No EffectHandler matched/,
    );
  });

  it("按顺序累积所有 handler 产出的 appendedMessages", async () => {
    const interpreter = new HandlerEffectInterpreter<string>([
      recordingHandler("a", { appended: [userMessage("m1")] }),
      recordingHandler("b", { appended: [userMessage("m2")] }),
    ]);

    const result = await interpreter.apply([{ type: "a" }, { type: "b" }]);

    expect(result.appendedMessages).toEqual([userMessage("m1"), userMessage("m2")]);
  });

  it("control 取最后一个产出 control 的 handler（覆盖语义）", async () => {
    const interpreter = new HandlerEffectInterpreter<string>([
      recordingHandler("a", { control: "first" }),
      recordingHandler("b", { control: "last" }),
    ]);

    const result = await interpreter.apply([{ type: "a" }, { type: "b" }]);

    expect(result.control).toBe("last");
  });

  it("没有任何 handler 产出 control 时结果不带 control 字段", async () => {
    const interpreter = new HandlerEffectInterpreter<string>([
      recordingHandler("a", { appended: [userMessage("m1")] }),
    ]);

    const result = await interpreter.apply([{ type: "a" }]);

    expect("control" in result).toBe(false);
  });
});

describe("ReplaceLeadingMessagesHandler", () => {
  function createTarget(): {
    target: ReplaceLeadingMessagesTarget;
    calls: Array<{ count: number; replacement: LlmMessage[] }>;
  } {
    const calls: Array<{ count: number; replacement: LlmMessage[] }> = [];
    return {
      calls,
      target: {
        async replaceLeadingMessages(count, replacement) {
          calls.push({ count, replacement });
        },
      },
    };
  }

  it("只匹配 replace_leading_messages 类型", () => {
    const { target } = createTarget();
    const handler = new ReplaceLeadingMessagesHandler(target);

    expect(handler.matches({ type: REPLACE_LEADING_MESSAGES_EFFECT_TYPE })).toBe(true);
    expect(handler.matches({ type: "append_message" })).toBe(false);
  });

  it("把 count 与 replacement 透传给 target，并返回空结果（不走追加协议）", async () => {
    const { target, calls } = createTarget();
    const handler = new ReplaceLeadingMessagesHandler(target);
    const replacement = [userMessage("summary")];
    const effect: ReplaceLeadingMessagesEffect = {
      type: REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
      count: 7,
      replacement,
    };

    const result = await handler.handle(effect);

    expect(result).toEqual({});
    expect(calls).toHaveLength(1);
    expect(calls[0].count).toBe(7);
    expect(calls[0].replacement).toEqual(replacement);
  });

  it("传给 target 的是 replacement 的副本，而非原数组引用（防别名 mutation）", async () => {
    const { target, calls } = createTarget();
    const handler = new ReplaceLeadingMessagesHandler(target);
    const replacement = [userMessage("summary")];

    await handler.handle({
      type: REPLACE_LEADING_MESSAGES_EFFECT_TYPE,
      count: 1,
      replacement,
    });

    expect(calls[0].replacement).not.toBe(replacement);
  });
});
