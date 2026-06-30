import { describe, expect, it } from "vitest";
import type {
  LlmChatCallItem as LlmChatCallDaoItem,
  LlmChatCallSummary as LlmChatCallDaoSummary,
} from "@kagami/persistence/dao/llm-chat-call.dao";
import {
  mapLlmChatCallDetail,
  mapLlmChatCallSummary,
} from "../../src/ops/mappers/llm-chat-call.mapper.js";

describe("llm-chat-call mapper", () => {
  it("mapLlmChatCallSummary should serialize createdAt and preserve summary fields", () => {
    const item: LlmChatCallDaoSummary = {
      id: 1,
      requestId: "req-1",
      seq: 7,
      provider: "openai",
      model: "gpt-test",
      extension: { foo: "bar" },
      status: "failed",
      latencyMs: null,
      createdAt: new Date("2026-04-02T03:04:05.000Z"),
    };

    expect(mapLlmChatCallSummary(item)).toEqual({
      id: 1,
      requestId: "req-1",
      seq: 7,
      provider: "openai",
      model: "gpt-test",
      extension: { foo: "bar" },
      status: "failed",
      latencyMs: null,
      createdAt: "2026-04-02T03:04:05.000Z",
    });
  });

  it("mapLlmChatCallDetail should include payload fields on top of the summary shape", () => {
    const item: LlmChatCallDaoItem = {
      id: 2,
      requestId: "req-2",
      seq: 1,
      provider: "openai",
      model: "gpt-test",
      extension: null,
      status: "success",
      requestPayload: { messages: [] },
      responsePayload: { ok: true },
      nativeRequestPayload: { native: "req" },
      nativeResponsePayload: null,
      error: null,
      nativeError: { status: 500 },
      latencyMs: 9,
      createdAt: new Date("2026-04-02T03:04:05.000Z"),
    };

    expect(mapLlmChatCallDetail(item)).toEqual({
      id: 2,
      requestId: "req-2",
      seq: 1,
      provider: "openai",
      model: "gpt-test",
      extension: null,
      status: "success",
      latencyMs: 9,
      createdAt: "2026-04-02T03:04:05.000Z",
      requestPayload: { messages: [] },
      responsePayload: { ok: true },
      nativeRequestPayload: { native: "req" },
      nativeResponsePayload: null,
      error: null,
      nativeError: { status: 500 },
    });
  });
});
