import { describe, expect, it, vi } from "vitest";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { HttpLlmClient } from "../../src/llm/http-llm-client.js";
import type { LlmChatRequest } from "@kagami/llm-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sampleRequest: LlmChatRequest = {
  messages: [{ role: "user", content: "ping" }],
  tools: [],
  toolChoice: "none",
};

describe("HttpLlmClient", () => {
  it("encodes chat request + options and decodes the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        provider: "openai",
        model: "gpt-4o-mini",
        message: { role: "assistant", content: "pong", toolCalls: [] },
      }),
    );
    const client = new HttpLlmClient({ baseUrl: "http://127.0.0.1:20009/", fetch: fetchMock });

    const result = await client.chat(sampleRequest, { usage: "agent", recordCall: false });

    expect(result).toMatchObject({ provider: "openai", model: "gpt-4o-mini" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:20009/internal/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      request: sampleRequest,
      usage: "agent",
      recordCall: false,
    });
  });

  it("passes usage as query for listAvailableProviders", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: "openai", models: ["m"] }]));
    const client = new HttpLlmClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    const result = await client.listAvailableProviders({ usage: "vision" });

    expect(result).toEqual([{ id: "openai", models: ["m"] }]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://127.0.0.1:20009/internal/providers?usage=vision",
    );
  });

  it("rebuilds a BizError from the error envelope (preserving message/meta/statusCode)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            name: "BizError",
            message: "所选 LLM provider 当前不可用",
            meta: { provider: "openai" },
            statusCode: 503,
          },
        },
        503,
      ),
    );
    const client = new HttpLlmClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    await expect(client.chat(sampleRequest, { usage: "agent" })).rejects.toMatchObject({
      name: "BizError",
      message: "所选 LLM provider 当前不可用",
      meta: { provider: "openai" },
      statusCode: 503,
    } satisfies Partial<BizError>);
  });

  it("maps unreachable service to a retryable BizError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new HttpLlmClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    await expect(client.chat(sampleRequest, { usage: "agent" })).rejects.toMatchObject({
      name: "BizError",
      message: "LLM 上游服务调用失败",
    });
  });

  it("maps a non-envelope error status to a retryable BizError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ oops: true }, 502));
    const client = new HttpLlmClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    await expect(client.chat(sampleRequest, { usage: "agent" })).rejects.toMatchObject({
      name: "BizError",
      message: "LLM 上游服务调用失败",
      meta: { reason: "bad_status", status: 502 },
    });
  });
});
