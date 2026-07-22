import { describe, expect, it } from "vitest";
import { createContextCompactionPlan } from "../../src/agent/runtime/context/context-compaction.js";
import { createUserMessage } from "../../src/agent/runtime/context/context-message-factory.js";
import type { LlmMessage } from "@kagami/llm-client";

const IMAGE_COUNT_THRESHOLD = 550;

function createImageUserMessage(imageCount: number): LlmMessage {
  return {
    role: "user",
    content: Array.from({ length: imageCount }, (_, index) => ({
      type: "image" as const,
      content: `base64-${String(index)}`,
      mimeType: "image/png",
    })),
  };
}

describe("createContextCompactionPlan", () => {
  it("returns null when total tokens do not exceed the threshold", () => {
    expect(
      createContextCompactionPlan({
        messages: [createUserMessage("alpha")],
        totalTokens: 100,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toBeNull();
  });

  it("falls back to summary only when there is only one message", () => {
    expect(
      createContextCompactionPlan({
        messages: [createUserMessage("alpha")],
        totalTokens: 101,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toEqual({
      messagesToSummarize: [createUserMessage("alpha")],
      messagesToKeep: [],
    });
  });

  it("triggers on image count even when total tokens stay below the threshold", () => {
    const messages = [createImageUserMessage(IMAGE_COUNT_THRESHOLD + 1)];

    expect(
      createContextCompactionPlan({
        messages,
        totalTokens: 100,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toEqual({
      messagesToSummarize: messages,
      messagesToKeep: [],
    });
  });

  it("counts images across multiple user messages and ignores text-only content", () => {
    const messages = [
      createUserMessage("text-only"),
      createImageUserMessage(300),
      createImageUserMessage(250),
    ];

    expect(
      createContextCompactionPlan({
        messages,
        totalTokens: 100,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toBeNull();

    const overMessages = [...messages, createImageUserMessage(1)];
    expect(
      createContextCompactionPlan({
        messages: overMessages,
        totalTokens: 100,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).not.toBeNull();
  });

  it("triggers on image count when total tokens are unavailable", () => {
    const messages = [createImageUserMessage(IMAGE_COUNT_THRESHOLD + 1)];

    expect(
      createContextCompactionPlan({
        messages,
        totalTokens: null,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).not.toBeNull();
  });

  it("returns null when total tokens are unavailable and image count is within the threshold", () => {
    expect(
      createContextCompactionPlan({
        messages: [createUserMessage("alpha")],
        totalTokens: null,
        totalTokenThreshold: 100,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toBeNull();
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
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
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
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toEqual({
      messagesToSummarize: messages.slice(0, -1),
      messagesToKeep: [tailMessage],
    });
  });
});
