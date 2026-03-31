import { describe, expect, it } from "vitest";
import { createContextCompactionPlan } from "../../src/agent/runtime/context/context-compaction.js";
import { createUserMessage } from "../../src/agent/runtime/context/context-message-factory.js";

describe("createContextCompactionPlan", () => {
  it("returns null when total tokens do not exceed the threshold", () => {
    expect(
      createContextCompactionPlan({
        messages: [createUserMessage("alpha")],
        totalTokens: 100,
        totalTokenThreshold: 100,
      }),
    ).toBeNull();
  });

  it("falls back to summary only when there is only one message", () => {
    expect(
      createContextCompactionPlan({
        messages: [createUserMessage("alpha")],
        totalTokens: 101,
        totalTokenThreshold: 100,
      }),
    ).toEqual({
      messagesToSummarize: [createUserMessage("alpha")],
      messagesToKeep: [],
    });
  });

  it("includes the matching tool result when the cut lands on an assistant tool call", () => {
    const messages = [
      ...Array.from({ length: 8 }, (_, index) => createUserMessage(`history-${index + 1}`)),
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "tool-1", name: "wait", arguments: {} }],
      },
      {
        role: "tool" as const,
        toolCallId: "tool-1",
        content: "tool-result-1",
      },
    ];

    expect(
      createContextCompactionPlan({
        messages,
        totalTokens: 100,
        totalTokenThreshold: 1,
      }),
    ).toEqual({
      messagesToSummarize: messages,
      messagesToKeep: [],
    });
  });

  it("extends compaction through the last matching tool result and keeps unrelated tail messages", () => {
    const historyMessages = Array.from({ length: 26 }, (_, index) =>
      createUserMessage(`history-${index + 1}`),
    );
    const tailMessage = createUserMessage("tail-message");
    const messages = [
      ...historyMessages,
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          { id: "tool-1", name: "wait", arguments: {} },
          { id: "tool-2", name: "wait", arguments: {} },
        ],
      },
      {
        role: "tool" as const,
        toolCallId: "tool-1",
        content: "tool-result-1",
      },
      createUserMessage("mid-message"),
      {
        role: "tool" as const,
        toolCallId: "tool-2",
        content: "tool-result-2",
      },
      tailMessage,
    ];

    expect(
      createContextCompactionPlan({
        messages,
        totalTokens: 100,
        totalTokenThreshold: 1,
      }),
    ).toEqual({
      messagesToSummarize: messages.slice(0, -1),
      messagesToKeep: [tailMessage],
    });
  });
});
