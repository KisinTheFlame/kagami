import { type LlmChatCallItem } from "@kagami/console-api/llm-chat-call";
import { describe, expect, it } from "vitest";
import { parseLlmChatCallDetail } from "@/pages/llm-history/llm-chat-call-detail-parser";

// #573 起主 Agent 开了 adaptive thinking，request_payload 里 assistant 消息带 thinkingBlocks、
// root 带 thinking 档位。契约 schema 是 .strict() 的：一旦哪天有人把这两个字段从
// @kagami/llm-api/llm-chat 摘掉，前端就会当场退化成「结构化解析失败」红框、整个 LLM
// 调用历史对主 Agent 全线失效（issue #577 就是这么炸的）。这两条测试钉住这个回归。

function buildItem(requestPayload: Record<string, unknown>): LlmChatCallItem {
  return {
    id: 1,
    requestId: "req-1",
    seq: 1,
    provider: "claude-code",
    model: "claude-sonnet-4",
    scene: "agent",
    extension: null,
    status: "success",
    latencyMs: 1200,
    createdAt: "2026-07-25T00:00:00.000Z",
    requestPayload,
    responsePayload: {
      provider: "claude-code",
      model: "claude-sonnet-4",
      message: {
        role: "assistant",
        content: "回答",
        toolCalls: [],
        thinkingBlocks: [{ type: "thinking", thinking: "推理过程", signature: "sig-2" }],
      },
    },
    nativeResponsePayload: null,
    error: null,
    nativeError: null,
  };
}

describe("parseLlmChatCallDetail", () => {
  it("带 thinkingBlocks 与 root thinking 的 payload 解析无 schemaError", () => {
    const parsed = parseLlmChatCallDetail(
      buildItem({
        system: "你是小镜",
        model: "claude-sonnet-4",
        messages: [
          { role: "user", content: "在吗" },
          {
            role: "assistant",
            content: "在的",
            toolCalls: [],
            thinkingBlocks: [{ type: "thinking", thinking: "推理过程", signature: "sig-1" }],
          },
        ],
        tools: [],
        toolChoice: "auto",
        thinking: "low",
      }),
    );

    expect(parsed.schemaErrors).toEqual([]);
    expect(parsed.hasSchemaError).toBe(false);
    expect(parsed.request?.thinking).toBe("low");
    expect(parsed.response?.message.thinkingBlocks).toHaveLength(1);
  });

  it("thinking 与 redacted_thinking 混排时两个块都保留（徽章计数口径）", () => {
    const parsed = parseLlmChatCallDetail(
      buildItem({
        model: "claude-sonnet-4",
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [],
            thinkingBlocks: [
              { type: "thinking", thinking: "推理过程", signature: "sig-1" },
              { type: "redacted_thinking", data: "encrypted-blob" },
            ],
          },
        ],
        tools: [],
        toolChoice: "auto",
      }),
    );

    expect(parsed.hasSchemaError).toBe(false);

    const message = parsed.request?.messages[0];
    expect(message?.role).toBe("assistant");
    const blocks = message?.role === "assistant" ? message.thinkingBlocks : undefined;
    expect(blocks).toHaveLength(2);
    expect(blocks?.map(block => block.type)).toEqual(["thinking", "redacted_thinking"]);
  });
});
