import { describe, expect, it, vi } from "vitest";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";

/**
 * toolChoice auto + 「text 保留进上下文」的持久化边界契约（issue #268 语义修订）：
 *
 * 1. assistant turn 落 ledger/snapshot 时保留 content——text 不再是一次性草稿，而是随
 *    tool_use 一起进上下文，供后续轮次回看本轮思考。
 * 2. 零 toolCall 的纯文本轮也把 text 写进上下文（不再「零写入」），前提是 text 非空。
 * 3. control 工具调用仍不留痕（wait 除外）；被滤空后若仍有 text，则以 assistant(text, [])
 *    持久化，只有既无 text 又无留痕 tool_use 的空轮才整条丢弃。
 *
 * 追加发生在写入时；已写入的历史只追加不改写，不违反 KV 缓存的只追加原则。
 */
describe("RootAgentHost.commitRoundResult — assistant text 保留与纯文本轮写入", () => {
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

  it("有 toolCall 的轮：持久化的 assistant turn 保留 content 原文，toolCalls 保留", async () => {
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
      content: "我打算先看看列表再决定。",
      toolCalls: [{ id: "tc1", name: "invoke", arguments: { tool: "glance_hn" } }],
    });
  });

  it("business 工具空 content：tool_result 仍以空串持久化，维持 tool_use/tool_result 配对", async () => {
    const { host, tools, appendAssistantTurn, appendToolResult } = makeHost();
    const assistantMessage = {
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: "tc1", name: "invoke", arguments: { tool: "noop" } }],
    };

    await host.commitRoundResult(
      {
        completion: { message: assistantMessage },
        assistantMessage,
        toolExecutions: [
          {
            toolCall: assistantMessage.toolCalls[0],
            result: { content: "", kind: "business" },
            appendedMessages: [{ role: "tool", toolCallId: "tc1", content: "" }],
            effectMessages: [],
          },
        ],
        appendedMessages: [],
        shouldCommit: true,
      } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[0],
      tools,
    );

    // assistant tool_use 被持久化，就必须有配对 tool_result（空串合法）；
    // 丢结果会造成上下文不平衡 → provider 400 且每轮复发。
    expect(appendAssistantTurn).toHaveBeenCalledTimes(1);
    expect(appendToolResult).toHaveBeenCalledWith({ toolCallId: "tc1", content: "" });
  });

  it("零 toolCall 的纯文本轮：把 text 以 assistant(text, []) 写进上下文", async () => {
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

    // text 进上下文：assistant(text, []) 被持久化，无 tool_use 故无 tool_result。
    expect(appendAssistantTurn).toHaveBeenCalledTimes(1);
    expect(appendAssistantTurn).toHaveBeenCalledWith({
      role: "assistant",
      content: "这轮我没什么要做的。",
      toolCalls: [],
    });
    expect(appendToolResult).not.toHaveBeenCalled();
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it("空 content 且零留痕 tool_use 的空轮：无内容可留，整条丢弃", async () => {
    const { host, tools, appendAssistantTurn, appendToolResult, appendMessages } = makeHost();
    const assistantMessage = {
      role: "assistant" as const,
      content: "   ",
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

  it("control 工具轮（如 switch）：control 调用被滤掉，但 text 仍以 assistant(text, []) 保留", async () => {
    const { host, appendAssistantTurn, appendToolResult } = makeHost();
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

    // control tool_use 被滤掉、其 tool_result 也不持久化（配对对称，无孤儿）；但 text 保留。
    expect(appendAssistantTurn).toHaveBeenCalledTimes(1);
    expect(appendAssistantTurn).toHaveBeenCalledWith({
      role: "assistant",
      content: "切个 App。",
      toolCalls: [],
    });
    expect(appendToolResult).not.toHaveBeenCalled();
  });
});
