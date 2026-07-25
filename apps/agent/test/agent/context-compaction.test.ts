import { describe, expect, it } from "vitest";
import {
  createContextCompactionPlan,
  createContextCompactionSlice,
} from "../../src/agent/runtime/context/context-compaction.js";
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

  it("与 createContextCompactionSlice(90) 在同一输入下结果一致（自动压缩没有第二套切法）", () => {
    const messages = Array.from({ length: 37 }, (_, index) =>
      createUserMessage(`history-${String(index)}`),
    );

    expect(
      createContextCompactionPlan({
        messages,
        totalTokens: 100,
        totalTokenThreshold: 1,
        imageCountThreshold: IMAGE_COUNT_THRESHOLD,
      }),
    ).toEqual(createContextCompactionSlice({ messages, compressRatio: 90 }));
  });
});

describe("createContextCompactionSlice", () => {
  it("compressRatio 90：20 条消息摘要 18 条、保留 2 条", () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      createUserMessage(`m-${String(index)}`),
    );

    expect(createContextCompactionSlice({ messages, compressRatio: 90 })).toEqual({
      messagesToSummarize: messages.slice(0, 18),
      messagesToKeep: messages.slice(18),
    });
  });

  it("compressRatio 50：20 条消息对半切", () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      createUserMessage(`m-${String(index)}`),
    );

    expect(createContextCompactionSlice({ messages, compressRatio: 50 })).toEqual({
      messagesToSummarize: messages.slice(0, 10),
      messagesToKeep: messages.slice(10),
    });
  });

  it("compressRatio 100：全部摘要、一条不留", () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      createUserMessage(`m-${String(index)}`),
    );

    expect(createContextCompactionSlice({ messages, compressRatio: 100 })).toEqual({
      messagesToSummarize: messages,
      messagesToKeep: [],
    });
  });

  it("切点落在 assistant tool call 上时向后扩，保留段绝不以 tool 消息打头", () => {
    const messages = [
      ...Array.from({ length: 8 }, (_, index) => createUserMessage(`history-${String(index)}`)),
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
      createUserMessage("tail-1"),
      createUserMessage("tail-2"),
    ];

    // 名义 keepCount = max(1, ceil(12 × 0.25)) = 3 → cutIndex 9，正好落在 assistant tool call
    // 之后、它的 tool 结果之前；边界扩展把 cutIndex 推到 10，实际摘要条数多于名义值。
    const plan = createContextCompactionSlice({ messages, compressRatio: 75 });
    expect(plan?.messagesToSummarize).toHaveLength(10);
    expect(plan?.messagesToKeep).toHaveLength(2);
    expect(plan?.messagesToKeep[0]?.role).not.toBe("tool");
  });

  it("切点落在同一组 tool 结果中间时整组划到摘要侧，保留段不会以孤儿 tool 打头", () => {
    const messages = [
      ...Array.from({ length: 6 }, (_, index) => createUserMessage(`history-${String(index)}`)),
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          { id: "tool-1", name: "wait", arguments: {} },
          { id: "tool-2", name: "wait", arguments: {} },
        ],
      },
      { role: "tool" as const, toolCallId: "tool-1", content: "tool-result-1" },
      { role: "tool" as const, toolCallId: "tool-2", content: "tool-result-2" },
      createUserMessage("tail-1"),
      createUserMessage("tail-2"),
    ];

    // 名义 keepCount = max(1, ceil(11 × 0.25)) = 3 → cutIndex 8，正好切在 tool-1 与 tool-2
    // 之间：切点前一条是 tool 而不是 assistant，旧的边界扩展在这里不生效。
    const plan = createContextCompactionSlice({ messages, compressRatio: 75 });
    expect(plan?.messagesToSummarize).toHaveLength(9);
    expect(plan?.messagesToKeep).toEqual([messages[9], messages[10]]);
    expect(plan?.messagesToKeep.some(message => message.role === "tool")).toBe(false);
  });

  it("按比例算下来一条都不该摘要时返回 null", () => {
    // 2 条消息 × compressRatio 10 → keepCount = max(1, ceil(2 × 0.9)) = 2 → cutIndex 0。
    expect(
      createContextCompactionSlice({
        messages: [createUserMessage("m-0"), createUserMessage("m-1")],
        compressRatio: 10,
      }),
    ).toBeNull();
  });

  it("空列表返回 null；单条消息一律全摘要", () => {
    expect(createContextCompactionSlice({ messages: [], compressRatio: 90 })).toBeNull();

    const single = [createUserMessage("only")];
    expect(createContextCompactionSlice({ messages: single, compressRatio: 90 })).toEqual({
      messagesToSummarize: single,
      messagesToKeep: [],
    });
  });
});
