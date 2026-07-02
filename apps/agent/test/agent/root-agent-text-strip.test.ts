import { describe, expect, it, vi } from "vitest";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";

/**
 * toolChoice auto + 「text 不进上下文」的持久化边界契约（issue #268）：
 *
 * 1. assistant turn 落 ledger/snapshot 前剥掉 content——text 是一次性草稿，完整
 *    原文只留在 llm_chat_call 审计记录里。
 * 2. 零 toolCall 的纯文本轮不产生任何上下文写入（不留空壳 assistant 消息）。
 *
 * 剥离发生在写入时；已写入的历史只追加不改写，不违反 KV 缓存的只追加原则。
 */
describe("RootAgentHost.commitRoundResult — assistant text 剥离与纯文本轮零写入", () => {
  function makeHost() {
    const appendAssistantTurn = vi.fn(async () => {});
    const appendToolResult = vi.fn(async () => {});
    const appendMessages = vi.fn(async () => {});

    const host = new RootAgentHost({
      context: { appendAssistantTurn, appendToolResult, appendMessages },
      eventQueue: {},
      session: {},
      interpreter: {},
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    const tools = {
      getKind: () => "business",
      definitions: () => [],
      execute: async () => ({ content: "" }),
    } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[1];

    return { host, tools, appendAssistantTurn, appendToolResult, appendMessages };
  }

  it("有 toolCall 的轮：持久化的 assistant turn content 恒为空串，toolCalls 保留", async () => {
    const { host, tools, appendAssistantTurn } = makeHost();
    const assistantMessage = {
      role: "assistant" as const,
      content: "我打算先看看列表再决定。",
      toolCalls: [{ id: "tc1", name: "invoke", arguments: { tool: "glance_hn" } }],
    };

    await host.commitRoundResult(
      {
        completion: { message: assistantMessage },
        assistantMessage,
        toolExecutions: [
          {
            toolCall: assistantMessage.toolCalls[0],
            result: { content: '{"ok":true}', kind: "business" },
            appendedMessages: [{ role: "tool", toolCallId: "tc1", content: '{"ok":true}' }],
            effectMessages: [],
          },
        ],
        appendedMessages: [],
        shouldCommit: true,
      } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[0],
      tools,
    );

    expect(appendAssistantTurn).toHaveBeenCalledTimes(1);
    expect(appendAssistantTurn).toHaveBeenCalledWith({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc1", name: "invoke", arguments: { tool: "glance_hn" } }],
    });
  });

  it("零 toolCall 的纯文本轮：不 append 任何消息，上下文零痕迹", async () => {
    const { host, tools, appendAssistantTurn, appendToolResult, appendMessages } = makeHost();
    const assistantMessage = {
      role: "assistant" as const,
      content: "这轮我没什么要做的。",
      toolCalls: [],
    };

    await host.commitRoundResult(
      {
        completion: { message: assistantMessage },
        assistantMessage,
        toolExecutions: [],
        appendedMessages: [],
        shouldCommit: true,
      } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[0],
      tools,
    );

    expect(appendAssistantTurn).not.toHaveBeenCalled();
    expect(appendToolResult).not.toHaveBeenCalled();
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it("control 工具轮（如 switch）：control 调用被滤掉后视同纯文本轮，零写入", async () => {
    const { host, appendAssistantTurn, appendMessages } = makeHost();
    const controlTools = {
      getKind: () => "control",
      definitions: () => [],
      execute: async () => ({ content: "" }),
    } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[1];
    const assistantMessage = {
      role: "assistant" as const,
      content: "切个 App。",
      toolCalls: [{ id: "tc1", name: "switch", arguments: { app: "qq" } }],
    };

    await host.commitRoundResult(
      {
        completion: { message: assistantMessage },
        assistantMessage,
        toolExecutions: [
          {
            toolCall: assistantMessage.toolCalls[0],
            result: { content: "ok", kind: "control" },
            appendedMessages: [],
            effectMessages: [],
          },
        ],
        appendedMessages: [],
        shouldCommit: true,
      } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[0],
      controlTools,
    );

    expect(appendAssistantTurn).not.toHaveBeenCalled();
    expect(appendMessages).not.toHaveBeenCalled();
  });
});
