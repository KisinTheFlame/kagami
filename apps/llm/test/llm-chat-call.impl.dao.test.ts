import { beforeAll, describe, expect, it, vi } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { Database } from "../src/infra/db/client.js";
import { PrismaLlmChatCallDao } from "../src/infra/impl/llm-chat-call.impl.dao.js";
import { unpackRefs } from "../src/app/llm-payload-codec.js";
import { InMemoryChatCallTable, InMemoryLlmBlobDao } from "./helpers.js";

const SYSTEM = "你是小镜";
const TOOLS = [{ name: "invoke", parameters: { type: "object" as const, properties: {} } }];

function buildRequest(messageCount: number): Record<string, unknown> {
  return {
    system: SYSTEM,
    model: "claude-opus-4-6",
    toolChoice: "auto",
    thinking: "low",
    tools: TOOLS,
    messages: Array.from({ length: messageCount }, (_unused, index) => ({
      role: "tool",
      toolCallId: `toolu_${index}`,
      content: `结果 ${index}`,
    })),
  };
}

function createDao(): {
  dao: PrismaLlmChatCallDao;
  blobDao: InMemoryLlmBlobDao;
  table: InMemoryChatCallTable;
} {
  const blobDao = new InMemoryLlmBlobDao();
  const table = new InMemoryChatCallTable();

  return {
    dao: new PrismaLlmChatCallDao({ database: table.asDatabase(), blobDao }),
    blobDao,
    table,
  };
}

const BASE = {
  provider: "claude-code" as const,
  model: "claude-opus-4-6",
  latencyMs: 12,
};

describe("PrismaLlmChatCallDao — 内容寻址落库（#612）", () => {
  // DAO 的失败分支会打结构化日志；没有 runtime 会先炸在 logger 上，把真实错误盖掉。
  beforeAll(() => {
    initLoggerRuntime({ sinks: [{ write: () => {} }] });
  });

  it("连续两轮只追加 1 条 message：第二轮只新增 1 个 blob", async () => {
    const { dao, blobDao } = createDao();

    await dao.recordSuccess({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request: buildRequest(3),
      response: { ok: true },
    });
    const afterFirstRound = blobDao.size;

    const stats = await dao.recordSuccess({
      ...BASE,
      requestId: "req-2",
      seq: 1,
      request: buildRequest(4),
      response: { ok: true },
    });

    // 3 条 message + system + tools = 5 个 blob；第二轮只多出那条新 message。
    expect(afterFirstRound).toBe(5);
    expect(blobDao.size - afterFirstRound).toBe(1);
    expect(stats.insertedBlobCount).toBe(1);
    // 引用数仍是全量（4 条 message + system + tools），去重发生在存储层而不是引用层。
    expect(stats.referenceCount).toBe(6);
  });

  it("同 requestId 的重试 seq：逐字节相同的请求体新增 0 个 blob", async () => {
    const { dao, blobDao } = createDao();
    const request = buildRequest(5);

    await dao.recordError({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request,
      error: new Error("boom"),
    });
    const afterFirstAttempt = blobDao.size;

    const second = await dao.recordError({
      ...BASE,
      requestId: "req-1",
      seq: 2,
      request,
      error: new Error("boom"),
    });
    const third = await dao.recordError({
      ...BASE,
      requestId: "req-1",
      seq: 3,
      request,
      error: new Error("boom"),
    });

    expect(blobDao.size).toBe(afterFirstAttempt);
    expect(second.insertedBlobCount).toBe(0);
    expect(second.insertedStoredBytes).toBe(0);
    expect(third.insertedBlobCount).toBe(0);
  });

  it("findById 还原出的 requestPayload 与写入时深度相等", async () => {
    const { dao, blobDao, table } = createDao();
    const request = buildRequest(3);

    await dao.recordSuccess({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request,
      response: { ok: true },
    });

    const item = await dao.findById(1);
    expect(item?.requestPayload).toEqual(request);
    // 行内只留骨架与引用，messages 本体不在行上。
    const stored = table.created[0]!;
    expect(JSON.stringify(stored)).not.toContain("结果 0");
    expect(unpackRefs(stored.messageRefs as Uint8Array)).toHaveLength(3);
    expect(blobDao.size).toBe(5);
  });

  it("落单代理项（lone surrogate）原样往返，不被替换字符吞掉", async () => {
    const { dao } = createDao();
    // "\ud83d" 是半个 emoji：JSON.stringify 会转义成 \ud83d 字面量，字节层必须是合法 UTF-8。
    const request = {
      system: SYSTEM,
      tools: TOOLS,
      toolChoice: "auto",
      messages: [{ role: "tool", toolCallId: "t1", content: "半个 emoji: \ud83d" }],
    };

    await dao.recordSuccess({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request,
      response: { ok: true },
    });

    const item = await dao.findById(1);
    expect(item?.requestPayload).toEqual(request);
  });

  it("system 缺省与 system 为空串可区分", async () => {
    const { dao } = createDao();
    const withoutSystem = { tools: [], toolChoice: "auto", messages: [] };
    const withEmptySystem = { system: "", tools: [], toolChoice: "auto", messages: [] };

    await dao.recordSuccess({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request: withoutSystem,
      response: { ok: true },
    });
    await dao.recordSuccess({
      ...BASE,
      requestId: "req-2",
      seq: 1,
      request: withEmptySystem,
      response: { ok: true },
    });

    const first = await dao.findById(1);
    const second = await dao.findById(2);
    expect("system" in (first?.requestPayload ?? {})).toBe(false);
    expect(second?.requestPayload.system).toBe("");
  });

  it("request 上的未知字段原样透传（skeleton 不是白名单）", async () => {
    const { dao } = createDao();
    const request = {
      system: SYSTEM,
      tools: [],
      toolChoice: "auto",
      messages: [],
      futureKnob: { nested: [1, 2, 3] },
    };

    await dao.recordSuccess({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request,
      response: { ok: true },
    });

    const item = await dao.findById(1);
    expect(item?.requestPayload).toEqual(request);
  });

  it("引用的 blob 被误删时抛错，绝不返回半截 payload", async () => {
    const { dao, blobDao } = createDao();

    await dao.recordSuccess({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request: buildRequest(2),
      response: { ok: true },
    });
    await blobDao.deleteByIds([1]);

    await expect(dao.findById(1)).rejects.toThrow(/llm_blob#1 不存在/);
  });

  it("成功轮落库：不写 native 请求体，response 只留可序列化字段", async () => {
    const { dao, table } = createDao();

    await dao.recordSuccess({
      ...BASE,
      provider: "openai",
      model: "gpt-test",
      requestId: "req-1",
      seq: 1,
      extension: { metadata: { actualModel: "gpt-test-2026-03-17" } },
      request: { messages: [], tools: [], toolChoice: "auto" },
      nativeResponsePayload: { id: "native-1", value: "ok" },
      response: {
        provider: "openai" as const,
        model: "gpt-test",
        message: { role: "assistant" as const, content: "done", toolCalls: [] },
        usage: { totalTokens: 5 },
        text: () => "done",
        json: () => ({ done: true }),
        toolCalls: () => [],
      },
    });

    const stored = table.created[0]!;
    expect(stored).not.toHaveProperty("nativeRequestPayload");
    expect(stored.status).toBe("success");
    expect(stored.nativeResponsePayload).toEqual({ id: "native-1", value: "ok" });
    // 函数字段不可序列化，落库前已被剥掉。
    expect(stored.responsePayload).toEqual({
      provider: "openai",
      model: "gpt-test",
      message: { role: "assistant", content: "done", toolCalls: [] },
      usage: { totalTokens: 5 },
    });
  });

  it("失败轮落库：native_error 完整保留（4xx 真因的唯一落点）", async () => {
    const { dao, table } = createDao();

    await dao.recordError({
      ...BASE,
      requestId: "req-1",
      seq: 1,
      request: { messages: [], tools: [], toolChoice: "auto" },
      nativeError: { status: 400, message: "prompt is too long" },
      error: new Error("upstream failed"),
    });

    const stored = table.created[0]!;
    expect(stored).not.toHaveProperty("nativeRequestPayload");
    expect(stored.status).toBe("failed");
    expect(stored.nativeError).toEqual({ status: 400, message: "prompt is too long" });
    expect(stored.error).toEqual({ name: "Error", message: "upstream failed", code: undefined });
  });

  it("写库失败时记录结构化日志并原样抛出", async () => {
    const blobDao = new InMemoryLlmBlobDao();
    const create = vi.fn().mockRejectedValue(new Error("disk full"));
    const database = { llmChatCall: { create } } as unknown as Database;
    const dao = new PrismaLlmChatCallDao({ database, blobDao });

    await expect(
      dao.recordSuccess({
        ...BASE,
        requestId: "req-1",
        seq: 1,
        request: { messages: [], tools: [], toolChoice: "auto" },
        response: { ok: true },
      }),
    ).rejects.toThrow("disk full");
  });
});
