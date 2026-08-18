import { describe, expect, it, vi } from "vitest";
import type { LlmChatCallObservation } from "@kagami/llm-client";
import type { LlmChatCallDao, LlmChatCallWriteStats } from "../src/infra/llm-chat-call.dao.js";
import { persistLlmChatCall } from "../src/app/persist-llm-chat-call.js";

const NO_BLOBS: LlmChatCallWriteStats = {
  referenceCount: 0,
  insertedBlobCount: 0,
  insertedStoredBytes: 0,
};

function createDao(): LlmChatCallDao & {
  recordSuccess: ReturnType<typeof vi.fn>;
  recordError: ReturnType<typeof vi.fn>;
} {
  return {
    countByQuery: vi.fn(),
    listPage: vi.fn(),
    findById: vi.fn(),
    listRefPage: vi.fn(),
    recordSuccess: vi.fn().mockResolvedValue(NO_BLOBS),
    recordError: vi.fn().mockResolvedValue(NO_BLOBS),
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
  nativeResponsePayload: null,
  nativeError: { message: "boom" },
  error: new Error("boom"),
};

describe("persistLlmChatCall — native 请求体不再落库（#612）", () => {
  it("成功轮：透传 request / response / native 响应体，且入参里没有 nativeRequestPayload", async () => {
    const dao = createDao();

    await persistLlmChatCall(dao, successObservation);

    expect(dao.recordError).not.toHaveBeenCalled();
    expect(dao.recordSuccess).toHaveBeenCalledTimes(1);
    const input = dao.recordSuccess.mock.calls[0]![0] as Record<string, unknown>;
    // 核心：native 请求体这个键根本不出现（不是置 null，是彻底不传）。
    expect("nativeRequestPayload" in input).toBe(false);
    expect(input.request).toEqual({ messages: ["history"] });
    expect(input.response).toEqual({ message: "ok" });
    expect(input.nativeResponsePayload).toEqual({ anthropic: "wire resp" });
    expect(input.requestId).toBe("req-1");
    // 归因 scene 透传落库（issue #555）。
    expect(input.scene).toBe("agent");
  });

  it("失败轮：native_error / native 响应体仍完整保留（4xx 真因的唯一落点）", async () => {
    const dao = createDao();

    await persistLlmChatCall(dao, errorObservation);

    expect(dao.recordSuccess).not.toHaveBeenCalled();
    expect(dao.recordError).toHaveBeenCalledTimes(1);
    const input = dao.recordError.mock.calls[0]![0] as Record<string, unknown>;
    expect("nativeRequestPayload" in input).toBe(false);
    // 删的只有 native 请求体；诊断真因这两项一个都不能少。
    expect(input.nativeError).toEqual({ message: "boom" });
    expect(input.error).toBeInstanceOf(Error);
    // chatDirect 无归因：scene 落 null。
    expect(input.scene).toBeNull();
  });

  it("把 DAO 的写入统计原样返回，供调用方打点", async () => {
    const dao = createDao();
    dao.recordSuccess.mockResolvedValue({
      referenceCount: 10,
      insertedBlobCount: 1,
      insertedStoredBytes: 128,
    });

    await expect(persistLlmChatCall(dao, successObservation)).resolves.toEqual({
      referenceCount: 10,
      insertedBlobCount: 1,
      insertedStoredBytes: 128,
    });
  });
});
