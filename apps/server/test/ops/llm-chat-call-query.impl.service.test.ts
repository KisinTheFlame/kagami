import { describe, expect, it, vi } from "vitest";
import type { LlmChatCallDao, LlmChatCallItem } from "@kagami/server-core/dao/llm-chat-call.dao";
import { DefaultLlmChatCallQueryService } from "../../src/ops/application/llm-chat-call-query.impl.service.js";
import { BizError } from "@kagami/server-core/common/errors/biz-error";

function makeDao(overrides: Partial<LlmChatCallDao>): LlmChatCallDao {
  return {
    countByQuery: vi.fn(),
    listPage: vi.fn(),
    findById: vi.fn(),
    recordSuccess: vi.fn(),
    recordError: vi.fn(),
    ...overrides,
  };
}

describe("DefaultLlmChatCallQueryService", () => {
  it("getDetail should throw BizError(404) when dao returns null", async () => {
    const llmChatCallDao = makeDao({
      findById: vi.fn().mockResolvedValue(null),
    });

    const service = new DefaultLlmChatCallQueryService({ llmChatCallDao });

    await expect(service.getDetail(999)).rejects.toMatchObject({
      name: "BizError",
      statusCode: 404,
      meta: {
        reason: "LLM_CHAT_CALL_NOT_FOUND",
        id: 999,
      },
    });
    await expect(service.getDetail(999)).rejects.toBeInstanceOf(BizError);
    expect(llmChatCallDao.findById).toHaveBeenCalledWith(999);
  });

  it("getDetail should return mapped detail when dao returns item", async () => {
    const daoItem: LlmChatCallItem = {
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
      createdAt: new Date("2026-04-02T03:04:05.000Z"),
    };
    const llmChatCallDao = makeDao({
      findById: vi.fn().mockResolvedValue(daoItem),
    });

    const service = new DefaultLlmChatCallQueryService({ llmChatCallDao });
    const result = await service.getDetail(42);

    expect(result).toEqual({
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
    });
  });
});
