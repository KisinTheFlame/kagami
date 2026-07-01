import { describe, expect, it, vi } from "vitest";
import { HttpEmbeddingClient } from "../../src/llm/http-embedding-client.js";
import type { EmbeddingRequest } from "@kagami/llm-client/embedding";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sampleRequest: EmbeddingRequest = {
  content: "hello",
  taskType: "RETRIEVAL_DOCUMENT",
  outputDimensionality: 768,
};

describe("HttpEmbeddingClient", () => {
  it("encodes the embed request and decodes the response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ provider: "google", model: "gemini-embed", embedding: [0.1, 0.2] }),
      );
    const client = new HttpEmbeddingClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    const result = await client.embed(sampleRequest);

    expect(result).toEqual({ provider: "google", model: "gemini-embed", embedding: [0.1, 0.2] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:20009/internal/embed");
    expect(JSON.parse(String(init.body))).toEqual({ request: sampleRequest });
  });

  it("rebuilds a BizError from the error envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { name: "BizError", message: "维度不匹配", statusCode: 400 } }, 400),
      );
    const client = new HttpEmbeddingClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    await expect(client.embed(sampleRequest)).rejects.toMatchObject({
      name: "BizError",
      message: "维度不匹配",
      statusCode: 400,
    });
  });

  it("maps unreachable service to a BizError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new HttpEmbeddingClient({ baseUrl: "http://127.0.0.1:20009", fetch: fetchMock });

    await expect(client.embed(sampleRequest)).rejects.toMatchObject({
      name: "BizError",
      message: "LLM 上游服务调用失败",
    });
  });
});
