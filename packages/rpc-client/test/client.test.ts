import { BizError } from "@kagami/kernel/errors/biz-error";
import { toBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import { defineJsonRoute } from "@kagami/http/contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createClient } from "../src/client.js";

const contracts = {
  getGreeting: defineJsonRoute({
    method: "GET",
    path: "/greeting",
    input: z.object({ name: z.string() }),
    output: z.object({ greeting: z.string() }),
  }),
  createThing: defineJsonRoute({
    method: "POST",
    path: "/things",
    input: z.object({ label: z.string() }),
    output: z.object({ id: z.string() }),
  }),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createClient", () => {
  it("GET：input 序列化进 query，响应经 output.parse 返回", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ greeting: "hi kagami" }));
    const client = createClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    const result = await client.getGreeting({ name: "kagami" });

    expect(result).toEqual({ greeting: "hi kagami" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://svc/greeting?name=kagami");
    expect(init.method).toBe("GET");
  });

  it("POST：input 进 JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "res-1" }));
    const client = createClient(contracts, { baseUrl: "http://svc/", fetch: fetchImpl });

    const result = await client.createThing({ label: "x" });

    expect(result).toEqual({ id: "res-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://svc/things");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ label: "x" }));
  });

  it("响应不合 output schema → 抛出（堵掉旧 as 空洞）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ wrong: "shape" }));
    const client = createClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    await expect(client.getGreeting({ name: "k" })).rejects.toThrow();
  });

  it("非 2xx 带 BizErrorWire 信封 → 重建等价 BizError（含 meta/statusCode）", async () => {
    const original = new BizError({
      message: "所选 LLM provider 当前不可用",
      meta: { reason: "provider_unavailable" },
      statusCode: 503,
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: toBizErrorWire(original) }, 503));
    const client = createClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    const err = await client.getGreeting({ name: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BizError);
    expect((err as BizError).message).toBe("所选 LLM provider 当前不可用");
    expect((err as BizError).meta).toEqual({ reason: "provider_unavailable" });
    expect((err as BizError).statusCode).toBe(503);
  });

  it("非 2xx 无富信封 → 用 unreachableMessage 兜底（保 llm retry 语义）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ plain: "err" }, 500));
    const client = createClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      unreachableMessage: "LLM 上游服务调用失败",
    });

    const err = await client.getGreeting({ name: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BizError);
    expect((err as BizError).message).toBe("LLM 上游服务调用失败");
  });

  it("fetch 抛出（不可达/超时）→ BizError(unreachableMessage)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      unreachableMessage: "LLM 上游服务调用失败",
    });

    const err = await client.getGreeting({ name: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BizError);
    expect((err as BizError).message).toBe("LLM 上游服务调用失败");
    expect((err as BizError).meta).toEqual({ reason: "unreachable" });
  });

  it("自定义 decodeError 覆盖默认通道（browser 用它重建 BrowserError）", async () => {
    class FakeBrowserError extends Error {
      public constructor(public readonly code: string) {
        super(`browser: ${code}`);
      }
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "TIMEOUT" }, 500));
    const client = createClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      decodeError: (_status, body) => {
        const code = (body as { code?: string }).code;
        return code ? new FakeBrowserError(code) : undefined;
      },
    });

    const err = await client.getGreeting({ name: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FakeBrowserError);
    expect((err as FakeBrowserError).code).toBe("TIMEOUT");
  });
});
