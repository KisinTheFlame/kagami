import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/client.js";
import { PrismaLlmChatCallDao } from "../../src/llm/dao/impl/llm-chat-call.impl.dao.js";

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
      extension: {
        metadata: {
          actualModel: "gpt-test-2026-03-17",
        },
      },
      latencyMs: 12,
      request: {
        messages: [],
        tools: [],
        toolChoice: "auto",
      },
      nativeRequestPayload: {
        model: "gpt-test",
        messages: [],
      },
      nativeResponsePayload: {
        id: "native-1",
        value: "ok",
      },
      response: responseWithExtraMethods,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        requestId: "req-1",
        seq: 1,
        provider: "openai",
        model: "gpt-test",
        extension: {
          metadata: {
            actualModel: "gpt-test-2026-03-17",
          },
        },
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
        nativeRequestPayload: {
          model: "gpt-test",
          messages: [],
        },
        nativeResponsePayload: {
          id: "native-1",
          value: "ok",
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
      extension: {
        metadata: {
          actualModel: "gpt-test-2026-03-17",
        },
      },
      latencyMs: 34,
      request: {
        messages: [],
        tools: [],
        toolChoice: "auto",
      },
      nativeRequestPayload: {
        model: "gpt-test",
        messages: [],
      },
      nativeResponsePayload: {
        id: "native-error-response",
      },
      nativeError: {
        status: 400,
        message: "invalid tool call",
      },
      response: {
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "send_message", arguments: { message: "hi" } }],
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
        extension: {
          metadata: {
            actualModel: "gpt-test-2026-03-17",
          },
        },
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
            toolCalls: [{ id: "call-1", name: "send_message", arguments: { message: "hi" } }],
          },
        },
        nativeRequestPayload: {
          model: "gpt-test",
          messages: [],
        },
        nativeResponsePayload: {
          id: "native-error-response",
        },
        error: {
          name: "Error",
          message: "invalid tool call",
          code: undefined,
        },
        nativeError: {
          status: 400,
          message: "invalid tool call",
        },
        latencyMs: 34,
      },
    });
  });

  it("should pass provider and model filters to prisma where clause", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      llmChatCall: {
        count,
        findMany,
      },
    } as unknown as Database;

    const dao = new PrismaLlmChatCallDao({ database });

    await dao.countByQuery({
      page: 1,
      pageSize: 20,
      provider: "openai",
      model: "gpt-5.4",
      status: "success",
    });

    await dao.listPage({
      page: 2,
      pageSize: 10,
      provider: "openai",
      model: "gpt-5.4",
      status: "failed",
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        provider: "openai",
        model: "gpt-5.4",
        status: "success",
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        provider: "openai",
        model: "gpt-5.4",
        status: "failed",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      skip: 10,
    });
  });

  it("should map extension when listing rows", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 1,
        requestId: "req-1",
        seq: 1,
        provider: "openai",
        model: "gpt-test",
        extension: {
          metadata: {
            actualModel: "gpt-test-2026-03-17",
          },
        },
        status: "success",
        requestPayload: {},
        responsePayload: {},
        nativeRequestPayload: null,
        nativeResponsePayload: null,
        error: null,
        nativeError: null,
        latencyMs: 10,
        createdAt: new Date("2026-03-24T00:00:00.000Z"),
      },
    ]);
    const database = {
      llmChatCall: {
        findMany,
      },
    } as unknown as Database;

    const dao = new PrismaLlmChatCallDao({ database });
    const rows = await dao.listPage({
      page: 1,
      pageSize: 20,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        extension: {
          metadata: {
            actualModel: "gpt-test-2026-03-17",
          },
        },
      }),
    ]);
  });
});
