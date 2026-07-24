import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../../src/agent/runtime/context/linear-message-ledger-agent-context.js";

describe("LinearMessageLedgerAgentContext", () => {
  it("records appended messages into the linear ledger", async () => {
    const insertMany = vi.fn().mockResolvedValue([]);
    const context = new LinearMessageLedgerAgentContext({
      inner: new DefaultAgentContext({
        systemPrompt: "test",
      }),
      linearMessageLedgerDao: {
        insertMany,
        listCreatedAfter: vi.fn(),
      },
      runtimeKey: "root-agent",
    });

    await context.appendMessages([
      {
        role: "user",
        content: "hello",
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "send_message",
            arguments: {},
          },
        ],
      },
    ]);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0]?.[0]).toEqual([
      {
        runtimeKey: "root-agent",
        message: {
          role: "user",
          content: "hello",
        },
      },
      {
        runtimeKey: "root-agent",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-1",
              name: "send_message",
              arguments: {},
            },
          ],
        },
      },
    ]);
  });

  it("does not write compaction replacements into the linear ledger", async () => {
    const insertMany = vi.fn().mockResolvedValue([]);
    const context = new LinearMessageLedgerAgentContext({
      inner: new DefaultAgentContext({
        systemPrompt: "test",
      }),
      linearMessageLedgerDao: {
        insertMany,
        listCreatedAfter: vi.fn(),
      },
      runtimeKey: "root-agent",
    });

    await context.appendMessages([{ role: "user", content: "old" }]);
    insertMany.mockClear();

    // compact 替换前缀不应写 linear ledger（ledger 只记真实增量消息）。
    await context.replaceLeadingMessages(1, [
      {
        role: "user",
        content: "summary",
      },
    ]);

    expect(insertMany).not.toHaveBeenCalled();
  });
});
