import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@kagami/llm";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";

/**
 * 回归测试（针对 glance_hn / ithome 列表"看不到内容"的根因）：
 *
 * tool 的 `append_message` effect 经 kernel interpreter 翻译后挂在
 * `toolExecution.effectMessages` 上。`RootAgentHost.commitRoundResult` 必须把它
 * 持久化进上下文——否则这些"屏幕"内容只在回合内可见、不进 ledger，下一轮 Agent
 * 就只剩 tool_result 的那句简短状态（如 `{count:10}`），看不到榜单本身。
 *
 * 修复前：commitRoundResult 只落 tool 结果，丢掉 effectMessages，
 * 本测试的 `append_message` 断言失败。
 */
describe("RootAgentHost.commitRoundResult — append_message effect 持久化", () => {
  function makeHost() {
    const order: string[] = [];
    const appended: LlmMessage[] = [];

    const context = {
      appendAssistantTurn: async () => {
        order.push("assistant");
      },
      appendToolResult: async (input: { toolCallId: string; content: string }) => {
        order.push(`toolResult:${input.content}`);
      },
      appendMessages: async (messages: LlmMessage[]) => {
        order.push(`append:${messages.length}`);
        appended.push(...messages);
      },
    };

    const host = new RootAgentHost({
      context,
      eventQueue: {},
      session: {},
      interpreter: {},
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    const tools = {
      getKind: () => "business",
      definitions: () => [],
      execute: async () => ({ content: "" }),
    } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[1];

    return { host, tools, order, appended };
  }

  function makeRoundResult(
    effectMessages: LlmMessage[],
  ): Parameters<RootAgentHost["commitRoundResult"]>[0] {
    const assistantMessage = {
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: "tc1", name: "invoke", arguments: { tool: "glance_hn" } }],
    };
    return {
      completion: { message: assistantMessage },
      assistantMessage,
      toolExecutions: [
        {
          toolCall: { id: "tc1", name: "invoke", arguments: { tool: "glance_hn" } },
          result: { content: '{"ok":true,"feed":"top","count":10}', kind: "business" },
          appendedMessages: [
            { role: "tool", toolCallId: "tc1", content: '{"ok":true,"feed":"top","count":10}' },
          ],
          effectMessages,
        },
      ],
      appendedMessages: [],
      shouldCommit: true,
    } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[0];
  }

  it("把 effectMessages（渲染好的榜单）append 进上下文，且排在 tool 结果之后", async () => {
    const { host, tools, order, appended } = makeHost();
    const frontPage: LlmMessage = {
      role: "user",
      content: '<hn_front_page feed="热榜">\n1. [id=1] Some HN Story\n</hn_front_page>',
    };

    await host.commitRoundResult(makeRoundResult([frontPage]), tools);

    // 榜单必须进上下文（修复前这里为空 → 失败）。
    expect(appended).toContainEqual(frontPage);
    // 顺序：assistant → tool 结果 → effect 屏幕。
    expect(order).toEqual([
      "assistant",
      'toolResult:{"ok":true,"feed":"top","count":10}',
      "append:1",
    ]);
  });

  it("没有 effectMessages 时不额外 append（不回归现有行为）", async () => {
    const { host, tools, order, appended } = makeHost();

    await host.commitRoundResult(makeRoundResult([]), tools);

    expect(appended).toHaveLength(0);
    expect(order).toEqual(["assistant", 'toolResult:{"ok":true,"feed":"top","count":10}']);
  });
});
