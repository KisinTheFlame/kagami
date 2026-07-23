import { describe, expect, it, vi } from "vitest";
import type { LlmChatCallObservation } from "@kagami/llm-client";
import type { LlmChatCallDao } from "../src/infra/llm-chat-call.dao.js";
import { persistLlmChatCall } from "../src/app/persist-llm-chat-call.js";

function createDao(): LlmChatCallDao & {
  recordSuccess: ReturnType<typeof vi.fn>;
  recordError: ReturnType<typeof vi.fn>;
} {
  return {
    countByQuery: vi.fn(),
    listPage: vi.fn(),
    findById: vi.fn(),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
  };
}

const successObservation: LlmChatCallObservation = {
  status: "success",
  provider: "claude-code",
  model: "claude",
  usage: "agent",
  scene: "agent",
  extension: { actualModel: "claude-actual" },
  requestId: "req-1",
  seq: 1,
  latencyMs: 42,
  request: { messages: ["history"] },
  response: { message: "ok" },
  nativeRequestPayload: { anthropic: "wire body" },
  nativeResponsePayload: { anthropic: "wire resp" },
};

const errorObservation: LlmChatCallObservation = {
  status: "failed",
  provider: "claude-code",
  model: "claude",
  usage: null,
  scene: null,
  extension: null,
  requestId: "req-2",
  seq: 1,
  latencyMs: 7,
  request: { messages: ["history"] },
  nativeRequestPayload: { anthropic: "wire body" },
  nativeResponsePayload: null,
  nativeError: { message: "boom" },
  error: new Error("boom"),
};

describe("persistLlmChatCall — 成功轮不落 native_request_payload", () => {
  it("成功轮：recordSuccess 的 nativeRequestPayload 置 null，其余字段透传", async () => {
    const dao = createDao();

    await persistLlmChatCall(dao, successObservation);

    expect(dao.recordError).not.toHaveBeenCalled();
    expect(dao.recordSuccess).toHaveBeenCalledTimes(1);
    const input = dao.recordSuccess.mock.calls[0]![0];
    // 核心：native 请求体不落库。
    expect(input.nativeRequestPayload).toBeNull();
    // 其余照常透传（含 request 全量、native 响应体、response）。
    expect(input.request).toEqual({ messages: ["history"] });
    expect(input.response).toEqual({ message: "ok" });
    expect(input.nativeResponsePayload).toEqual({ anthropic: "wire resp" });
    expect(input.requestId).toBe("req-1");
    // 归因 scene 透传落库（issue #555）。
    expect(input.scene).toBe("agent");
  });

  it("失败轮：recordError 完整保留 native_request_payload（诊断需要）", async () => {
    const dao = createDao();

    await persistLlmChatCall(dao, errorObservation);

    expect(dao.recordSuccess).not.toHaveBeenCalled();
    expect(dao.recordError).toHaveBeenCalledTimes(1);
    const input = dao.recordError.mock.calls[0]![0];
    // 失败轮 native 请求体必须留存。
    expect(input.nativeRequestPayload).toEqual({ anthropic: "wire body" });
    expect(input.nativeError).toEqual({ message: "boom" });
    expect(input.error).toBeInstanceOf(Error);
    // chatDirect 无归因：scene 落 null。
    expect(input.scene).toBeNull();
  });
});
