import { describe, expect, it, vi } from "vitest";
import type { LlmChatCallWireDetail } from "@kagami/llm-api/query";
import {
  DefaultLlmChatCallQueryService,
  type LlmQueryClient,
} from "../../src/ops/application/llm-chat-call-query.impl.service.js";
import { BizError } from "@kagami/kernel/errors/biz-error";

function makeClient(overrides: Partial<LlmQueryClient>): LlmQueryClient {
  return {
    queryLlmChatCalls: vi.fn(),
    getLlmChatCall: vi.fn(),
    ...overrides,
  };
}

describe("DefaultLlmChatCallQueryService", () => {
  it("getDetail should throw BizError(404) when llm reports not found", async () => {
    const llmQueryClient = makeClient({
      getLlmChatCall: vi.fn().mockResolvedValue({ found: false }),
    });

    const service = new DefaultLlmChatCallQueryService({ llmQueryClient });

    await expect(service.getDetail(999)).rejects.toMatchObject({
      name: "BizError",
      statusCode: 404,
      meta: {
        reason: "LLM_CHAT_CALL_NOT_FOUND",
        id: 999,
      },
    });
    await expect(service.getDetail(999)).rejects.toBeInstanceOf(BizError);
    expect(llmQueryClient.getLlmChatCall).toHaveBeenCalledWith({ id: 999 });
  });

  it("getDetail should pass through wire detail when found", async () => {
    const wireItem: LlmChatCallWireDetail = {
      id: 42,
      requestId: "req-42",
      seq: 1,
      provider: "openai",
      model: "gpt-test",
      extension: { foo: "bar" },
      status: "success",
      requestPayload: { messages: [] },
      responsePayload: { ok: true },
      nativeRequestPayload: { native: "req" },
      nativeResponsePayload: { native: "resp" },
      error: null,
      nativeError: null,
      latencyMs: 12,
      createdAt: "2026-04-02T03:04:05.000Z",
    };
    const llmQueryClient = makeClient({
      getLlmChatCall: vi.fn().mockResolvedValue({ found: true, item: wireItem }),
    });

    const service = new DefaultLlmChatCallQueryService({ llmQueryClient });
    const result = await service.getDetail(42);

    expect(result).toEqual(wireItem);
  });

  it("queryList should forward filters and wrap pagination envelope", async () => {
    const llmQueryClient = makeClient({
      queryLlmChatCalls: vi.fn().mockResolvedValue({ total: 3, items: [] }),
    });

    const service = new DefaultLlmChatCallQueryService({ llmQueryClient });
    const result = await service.queryList({
      page: 2,
      pageSize: 10,
      provider: "claude-code",
      model: undefined,
      status: "failed",
    });

    expect(llmQueryClient.queryLlmChatCalls).toHaveBeenCalledWith({
      provider: "claude-code",
      model: undefined,
      status: "failed",
      page: 2,
      pageSize: 10,
    });
    expect(result).toEqual({
      pagination: { page: 2, pageSize: 10, total: 3 },
      items: [],
    });
  });
});
