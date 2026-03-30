import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../../src/agent/runtime/context/linear-message-ledger-agent-context.js";

describe("LinearMessageLedgerAgentContext", () => {
  it("records appended messages and events into the linear ledger", async () => {
    const insertMany = vi.fn().mockResolvedValue([]);
    const context = new LinearMessageLedgerAgentContext({
      inner: new DefaultAgentContext({
        systemPrompt: "test",
      }),
      linearMessageLedgerDao: {
        insertMany,
        listAfterSeq: vi.fn(),
        countAfterSeq: vi.fn(),
        findLatest: vi.fn(),
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
    await context.appendEvents([
      {
        type: "napcat_group_message",
        data: {
          groupId: "123",
          userId: "456",
          nickname: "Alice",
          rawMessage: "你好",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "你好",
              },
            },
          ],
          messageId: 1,
          time: 1,
        },
      },
    ]);

    expect(insertMany).toHaveBeenCalledTimes(2);
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
    expect(insertMany.mock.calls[1]?.[0]?.[0]).toEqual({
      runtimeKey: "root-agent",
      message: {
        role: "user",
        content: "<qq_message>\nAlice (456):\n你好\n</qq_message>",
      },
    });
  });

  it("does not write compaction replacements into the linear ledger", async () => {
    const insertMany = vi.fn().mockResolvedValue([]);
    const context = new LinearMessageLedgerAgentContext({
      inner: new DefaultAgentContext({
        systemPrompt: "test",
      }),
      linearMessageLedgerDao: {
        insertMany,
        listAfterSeq: vi.fn(),
        countAfterSeq: vi.fn(),
        findLatest: vi.fn(),
      },
      runtimeKey: "root-agent",
    });

    await context.replaceMessages([
      {
        role: "user",
        content: "summary",
      },
    ]);

    expect(insertMany).not.toHaveBeenCalled();
  });
});
