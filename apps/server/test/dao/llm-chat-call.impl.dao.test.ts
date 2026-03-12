import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/client.js";
import { PrismaLlmChatCallDao } from "../../src/dao/impl/llm-chat-call.impl.dao.js";

describe("PrismaLlmChatCallDao", () => {
  it("should persist only serializable response payload fields", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const database = {
      llmChatCall: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaLlmChatCallDao({ database });
    const responseWithExtraMethods = {
      provider: "openai" as const,
      model: "gpt-test",
      message: {
        role: "assistant" as const,
        content: "done",
        toolCalls: [{ id: "call-1", name: "finish", arguments: {} }],
      },
      usage: {
        totalTokens: 5,
      },
      text: () => "done",
      json: () => ({ done: true }),
      toolCalls: () => [{ id: "call-1", name: "finish", arguments: {} }],
    };

    await dao.recordSuccess({
      requestId: "req-1",
      seq: 1,
      provider: "openai",
      model: "gpt-test",
      latencyMs: 12,
      request: {
        messages: [],
        tools: [],
        toolChoice: "auto",
      },
      response: responseWithExtraMethods,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        requestId: "req-1",
        seq: 1,
        provider: "openai",
        model: "gpt-test",
        status: "success",
        requestPayload: {
          messages: [],
          tools: [],
          toolChoice: "auto",
        },
        responsePayload: {
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "done",
            toolCalls: [{ id: "call-1", name: "finish", arguments: {} }],
          },
          usage: {
            totalTokens: 5,
          },
        },
        latencyMs: 12,
      },
    });
    expect(create.mock.calls[0]?.[0]?.data.responsePayload).not.toHaveProperty("text");
    expect(create.mock.calls[0]?.[0]?.data.responsePayload).not.toHaveProperty("json");
    expect(create.mock.calls[0]?.[0]?.data.responsePayload).not.toHaveProperty("toolCalls");
  });

  it("should persist response payload together with failed errors", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const database = {
      llmChatCall: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaLlmChatCallDao({ database });

    await dao.recordError({
      requestId: "req-2",
      seq: 2,
      provider: "openai",
      model: "gpt-test",
      latencyMs: 34,
      request: {
        messages: [],
        tools: [],
        toolChoice: "auto",
      },
      response: {
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "send_group_message", arguments: { message: "hi" } }],
        },
      },
      error: new Error("invalid tool call"),
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        requestId: "req-2",
        seq: 2,
        provider: "openai",
        model: "gpt-test",
        status: "failed",
        requestPayload: {
          messages: [],
          tools: [],
          toolChoice: "auto",
        },
        responsePayload: {
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call-1", name: "send_group_message", arguments: { message: "hi" } }],
          },
        },
        error: {
          name: "Error",
          message: "invalid tool call",
          code: undefined,
        },
        latencyMs: 34,
      },
    });
  });
});
