import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@kagami/llm";
import {
  ReActKernel,
  type ReActModel,
  type ReActKernelRunRoundInput,
} from "../src/react-kernel.js";
import type { Effect, EffectInterpreter } from "../src/effect.js";
import type { ToolExecutor, ToolExecutionResult } from "../src/tool/tool-component.js";

type Completion = { message: { role: "assistant"; content: string; toolCalls: unknown[] } };

/**
 * 回归测试:tool 的 `append_message` effect 经 interpreter 翻译后,必须挂到
 * `toolExecution.effectMessages` 上——这是 commit 方（如 RootAgentHost）持久化
 * 这些"屏幕"消息的唯一来源。漏了它,App 列表 / 文章正文就进不了 ledger。
 */
describe("ReActKernel.runRound — tool effects → toolExecution.effectMessages", () => {
  function makeModelWithOneToolCall(): ReActModel<"agent", Completion> {
    return {
      chat: async () => ({
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc1", name: "do", arguments: {} }],
        },
      }),
    } as unknown as ReActModel<"agent", Completion>;
  }

  // interpreter:把每个 append_message effect 译成一条 user 消息（模拟真 RootEffectInterpreter）。
  const interpreter: EffectInterpreter<never> = {
    apply: async (effects: readonly Effect[]) => ({
      appendedMessages: effects
        .filter(e => e.type === "append_message")
        .map(e => ({ role: "user", content: (e as { content: string }).content }) as LlmMessage),
    }),
  };

  function makeToolsReturning(result: ToolExecutionResult): ToolExecutor {
    return {
      definitions: () => [{ name: "do", parameters: { type: "object", properties: {} } }],
      getKind: () => "business",
      execute: async () => ({ ...result, kind: "business" }),
    } as unknown as ToolExecutor;
  }

  it("把 append_message effect 的产出放进 effectMessages（而非只在 round-level appendedMessages）", async () => {
    const screen = "<screen>front page content</screen>";
    const kernel = new ReActKernel<"agent", Completion>({
      model: makeModelWithOneToolCall(),
      interpreter,
    });

    const result = await kernel.runRound({
      state: { systemPrompt: undefined, messages: [] },
      tools: makeToolsReturning({
        content: '{"ok":true,"count":1}',
        effects: [{ type: "append_message", content: screen }],
      }),
      usage: "agent",
    } as unknown as ReActKernelRunRoundInput<"agent">);

    const exec = result.toolExecutions[0];
    expect(exec).toBeDefined();
    // 核心:effect 屏幕进了 toolExecution.effectMessages（commit 方据此落库）。
    expect(exec.effectMessages).toEqual([{ role: "user", content: screen }]);
    // tool_result 消息仍单独在 appendedMessages 里,不混进 effectMessages。
    expect(exec.appendedMessages).toEqual([
      { role: "tool", toolCallId: "tc1", content: '{"ok":true,"count":1}' },
    ]);
  });

  it("tool 没有 effects 时 effectMessages 为空数组", async () => {
    const kernel = new ReActKernel<"agent", Completion>({
      model: makeModelWithOneToolCall(),
      interpreter,
    });

    const result = await kernel.runRound({
      state: { systemPrompt: undefined, messages: [] },
      tools: makeToolsReturning({ content: '{"ok":true}' }),
      usage: "agent",
    } as unknown as ReActKernelRunRoundInput<"agent">);

    expect(result.toolExecutions[0].effectMessages).toEqual([]);
  });
});

/**
 * toolChoice auto 的两条基础契约：
 * 1. kernel 每轮请求发送 toolChoice "auto"（不再强制工具调用）。
 * 2. 零 toolCall 的纯文本轮是合法轮：shouldCommit true、toolExecutions/appendedMessages
 *    为空，text 的取舍由持久化边界决定（root 剥离、task agent 留在本地工作区）。
 */
describe("ReActKernel.runRound — toolChoice auto 与纯文本轮", () => {
  const noopInterpreter: EffectInterpreter<never> = {
    apply: async () => ({ appendedMessages: [] }),
  };

  it("每轮请求 toolChoice 为 auto", async () => {
    let seenToolChoice: string | undefined;
    const kernel = new ReActKernel<"agent", Completion>({
      model: {
        chat: async (request: { toolChoice: string }) => {
          seenToolChoice = request.toolChoice;
          return {
            message: { role: "assistant", content: "", toolCalls: [] },
          };
        },
      } as unknown as ReActModel<"agent", Completion>,
      interpreter: noopInterpreter,
    });

    await kernel.runRound({
      state: { systemPrompt: undefined, messages: [] },
      tools: makeNoTools(),
      usage: "agent",
    } as unknown as ReActKernelRunRoundInput<"agent">);

    expect(seenToolChoice).toBe("auto");
  });

  it("零 toolCall 的纯文本轮：shouldCommit true、无工具执行、无追加消息", async () => {
    const kernel = new ReActKernel<"agent", Completion>({
      model: {
        chat: async () => ({
          message: { role: "assistant", content: "我先想想再动手。", toolCalls: [] },
        }),
      } as unknown as ReActModel<"agent", Completion>,
      interpreter: noopInterpreter,
    });

    const result = await kernel.runRound({
      state: { systemPrompt: undefined, messages: [] },
      tools: makeNoTools(),
      usage: "agent",
    } as unknown as ReActKernelRunRoundInput<"agent">);

    expect(result.shouldCommit).toBe(true);
    expect(result.assistantMessage?.content).toBe("我先想想再动手。");
    expect(result.assistantMessage?.toolCalls).toEqual([]);
    expect(result.toolExecutions).toEqual([]);
    expect(result.appendedMessages).toEqual([]);
  });
});

function makeNoTools(): ToolExecutor {
  return {
    definitions: () => [],
    getKind: () => "business",
    execute: async () => ({ content: "", kind: "business" }),
  } as unknown as ToolExecutor;
}

describe("ReActKernel.runRound — tool_use/tool_result 配对", () => {
  it("tool 返回空 content 也产一条空串 tool 消息，维持 ReAct 配对", async () => {
    const kernel = new ReActKernel<"agent", Completion>({
      model: {
        chat: async () => ({
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "tc1", name: "do", arguments: {} }],
          },
        }),
      } as unknown as ReActModel<"agent", Completion>,
      interpreter: { apply: async () => ({ appendedMessages: [] }) } as EffectInterpreter<never>,
    });

    const result = await kernel.runRound({
      state: { systemPrompt: undefined, messages: [] },
      tools: {
        definitions: () => [{ name: "do", parameters: { type: "object", properties: {} } }],
        getKind: () => "business",
        execute: async () => ({ content: "", kind: "business" }),
      } as unknown as ToolExecutor,
      usage: "agent",
    } as unknown as ReActKernelRunRoundInput<"agent">);

    expect(result.toolExecutions[0].appendedMessages).toEqual([
      { role: "tool", toolCallId: "tc1", content: "" },
    ]);
  });
});
