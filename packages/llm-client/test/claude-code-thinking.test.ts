import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ClaudeCodeAuth, ClaudeCodeAuthProvider } from "../src/providers/claude-code-auth.js";
import { createClaudeCodeProvider } from "../src/providers/claude-code-provider.js";
import type { LlmChatRequest } from "../src/types.js";

// adaptive thinking（issue #573）专项：请求参数开关、thinking 块回放/剥离、SSE 重组。
// 既有黑盒测试（claude-code-provider.test.ts）钉死 disabled 默认路径逐字节不变，这里只测增量。

class StubAuthStore implements ClaudeCodeAuthProvider {
  public hasCredentials(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public getAuth(): Promise<ClaudeCodeAuth> {
    return Promise.resolve({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accountId: "user_123",
      email: "claude@example.com",
      lastRefresh: new Date().toISOString(),
      expiresAt: Date.now() + 60_000,
    } as ClaudeCodeAuth);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createProvider(): ReturnType<typeof createClaudeCodeProvider> {
  return createClaudeCodeProvider({
    config: {
      baseUrl: "https://api.anthropic.com",
      models: ["claude-opus-4-6"],
      timeoutMs: 5_000,
      keepAliveReplayIntervalMinutes: 30,
      useFileApi: true,
      fileCacheGcEnabled: true,
      fileCacheGcMaxIdleDays: 3,
      fileCacheGcMaxDeletionsPerRun: 2000,
    },
    authStore: new StubAuthStore(),
  });
}

function createSseResponse(events: unknown[]): string {
  return events.map(event => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function stubTextSse(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          createSseResponse([
            {
              type: "message_start",
              message: { type: "message", role: "assistant", model: "claude-opus-4-6" },
            },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "ok" } },
            { type: "content_block_stop", index: 0 },
            { type: "message_stop" },
          ]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
    ),
  );
}

function lastRequestBody(): Record<string, unknown> {
  const fetchMock = globalThis.fetch as unknown as Mock;
  const call = fetchMock.mock.calls.at(-1) as [unknown, { body: string }];
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

function createChatRequest(overrides: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return {
    system: "你是一个测试助手。",
    messages: [{ role: "user", content: "ping" }],
    tools: [],
    toolChoice: "auto",
    model: "claude-opus-4-6",
    ...overrides,
  };
}

describe("claude-code adaptive thinking request", () => {
  it("should send adaptive thinking with effort when request.thinking is set", async () => {
    stubTextSse();
    await createProvider().chat(createChatRequest({ thinking: "low" }));

    const body = lastRequestBody();
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("should keep thinking disabled and omit output_config when request.thinking is absent", async () => {
    stubTextSse();
    await createProvider().chat(createChatRequest());

    const body = lastRequestBody();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("output_config");
  });

  it("should replay thinking blocks front-loaded before text and tool_use when thinking is on", async () => {
    stubTextSse();
    await createProvider().chat(
      createChatRequest({
        thinking: "low",
        messages: [
          { role: "user", content: "question" },
          {
            role: "assistant",
            content: "draft",
            toolCalls: [{ id: "call_1", name: "lookup", arguments: { city: "Tokyo" } }],
            thinkingBlocks: [
              { type: "thinking", thinking: "推理过程", signature: "sig-1" },
              { type: "redacted_thinking", data: "opaque-bytes" },
            ],
          },
          { role: "tool", toolCallId: "call_1", content: "result" },
        ],
      }),
    );

    const body = lastRequestBody();
    const messages = body.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const assistant = messages.find(message => message.role === "assistant");
    expect(assistant?.content.map(block => block.type)).toEqual([
      "thinking",
      "redacted_thinking",
      "text",
      "tool_use",
    ]);
    expect(assistant?.content[0]).toEqual({
      type: "thinking",
      thinking: "推理过程",
      signature: "sig-1",
    });
  });

  it("should strip thinking blocks from replay when thinking is off", async () => {
    stubTextSse();
    await createProvider().chat(
      createChatRequest({
        messages: [
          { role: "user", content: "question" },
          {
            role: "assistant",
            content: "draft",
            toolCalls: [],
            thinkingBlocks: [{ type: "thinking", thinking: "推理过程", signature: "sig-1" }],
          },
        ],
      }),
    );

    const body = lastRequestBody();
    const messages = body.messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const assistant = messages.find(message => message.role === "assistant");
    expect(assistant?.content.map(block => block.type)).toEqual(["text"]);
  });

  it("should drop a thinking-only assistant message entirely (no text, no tool_use)", async () => {
    stubTextSse();
    await createProvider().chat(
      createChatRequest({
        thinking: "low",
        messages: [
          { role: "user", content: "question" },
          {
            role: "assistant",
            content: "",
            toolCalls: [],
            thinkingBlocks: [{ type: "thinking", thinking: "推理过程", signature: "sig-1" }],
          },
          { role: "user", content: "next" },
        ],
      }),
    );

    const body = lastRequestBody();
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.map(message => message.role)).toEqual(["user", "user"]);
  });
});

describe("claude-code adaptive thinking response", () => {
  it("should reassemble streamed thinking blocks in response order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            createSseResponse([
              {
                type: "message_start",
                message: { type: "message", role: "assistant", model: "claude-opus-4-6" },
              },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "thinking_delta", thinking: "第一段" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "thinking_delta", thinking: "第二段" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "signature_delta", signature: "sig-abc" },
              },
              { type: "content_block_stop", index: 0 },
              {
                type: "content_block_start",
                index: 1,
                content_block: { type: "redacted_thinking", data: "opaque" },
              },
              { type: "content_block_stop", index: 1 },
              {
                type: "content_block_start",
                index: 2,
                content_block: { type: "text", text: "回答" },
              },
              { type: "content_block_stop", index: 2 },
              {
                type: "content_block_start",
                index: 3,
                content_block: { type: "tool_use", id: "call_1", name: "lookup", input: {} },
              },
              { type: "content_block_stop", index: 3 },
              { type: "message_stop" },
            ]),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    const result = await createProvider().chat(createChatRequest({ thinking: "low" }));

    expect(result.response.message.thinkingBlocks).toEqual([
      { type: "thinking", thinking: "第一段第二段", signature: "sig-abc" },
      { type: "redacted_thinking", data: "opaque" },
    ]);
    expect(result.response.message.content).toBe("回答");
    expect(result.response.message.toolCalls).toEqual([
      { id: "call_1", name: "lookup", arguments: {} },
    ]);
  });

  it("should drop a thinking block whose signature never arrived (回放残块必 400，宁缺)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            createSseResponse([
              {
                type: "message_start",
                message: { type: "message", role: "assistant", model: "claude-opus-4-6" },
              },
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "无签名" },
              },
              { type: "content_block_stop", index: 0 },
              {
                type: "content_block_start",
                index: 1,
                content_block: { type: "text", text: "回答" },
              },
              { type: "content_block_stop", index: 1 },
              { type: "message_stop" },
            ]),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    const result = await createProvider().chat(createChatRequest({ thinking: "low" }));

    expect(result.response.message).not.toHaveProperty("thinkingBlocks");
    expect(result.response.message.content).toBe("回答");
  });
});
