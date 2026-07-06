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

describe("createClient — 默认 fetch 绑定 globalThis", () => {
  // 复现浏览器 brand-check：`fetch` 的 this 必须是 Window/globalThis，否则抛 Illegal invocation。
  // Node/undici 无此检查，故必须在测试里手动模拟——否则默认 fetch 路径（不传 options.fetch）
  // 在浏览器里 `ctx.fetchImpl(...)` 以 ctx 为接收者调用会炸，而 Node 测试永远绿，bug 就此溜过。
  function installBrowserFetch(response: Response): () => void {
    const original = globalThis.fetch;
    const browserFetch = function (this: unknown): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(response);
    };
    globalThis.fetch = browserFetch as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("不传 options.fetch → 默认 fetch 以 globalThis 为接收者调用（挡住 Illegal invocation 回归）", async () => {
    const restore = installBrowserFetch(jsonResponse({ greeting: "hi kagami" }));
    try {
      const client = createClient(contracts, { baseUrl: "http://svc" });
      await expect(client.getGreeting({ name: "kagami" })).resolves.toEqual({
        greeting: "hi kagami",
      });
    } finally {
      restore();
    }
  });
});

describe("createClient — params 通道", () => {
  const paramContracts = {
    getDetail: defineJsonRoute({
      method: "GET",
      path: "/items/:id",
      params: z.object({ id: z.number().int().positive() }),
      input: z.object({ verbose: z.boolean().optional() }),
      output: z.object({ id: z.number() }),
    }),
    trigger: defineJsonRoute({
      method: "POST",
      path: "/tasks/:name/trigger",
      params: z.object({ name: z.string().min(1) }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    }),
  };

  it("GET：params 插进路径段，input 进 query，两通道不串", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 42 }));
    const client = createClient(paramContracts, { baseUrl: "http://svc", fetch: fetchImpl });

    await client.getDetail({ params: { id: 42 }, input: { verbose: true } });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("http://svc/items/42?verbose=true");
  });

  it("POST：params 插路径，input 进 body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient(paramContracts, { baseUrl: "http://svc", fetch: fetchImpl });

    await client.trigger({ params: { name: "re index" }, input: {} });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://svc/tasks/re%20index/trigger");
    expect(init.body).toBe("{}");
  });

  it("params 不合 schema：请求发出前就抛（不打到网络）", async () => {
    const fetchImpl = vi.fn();
    const client = createClient(paramContracts, { baseUrl: "http://svc", fetch: fetchImpl });

    await expect(client.getDetail({ params: { id: -1 }, input: {} })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("负向类型：调用形状由契约决定（编译期强制，闭包只定义不执行）", () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    const client = createClient(paramContracts, { baseUrl: "http://svc", fetch: fetchImpl });
    const plainClient = createClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    const mustNotCompile = [
      // @ts-expect-error params 路由不能用扁平 input 直调
      () => client.getDetail({ verbose: true }),
      // @ts-expect-error params 路由必须带 params 键
      () => client.getDetail({ input: { verbose: true } }),
      // @ts-expect-error 无 params 路由不接受 { params, input } 包装
      () => plainClient.getGreeting({ params: {}, input: { name: "x" } }),
      // @ts-expect-error params 字段名必须匹配 schema
      () => client.trigger({ params: { wrong: "x" }, input: {} }),
    ];
    expect(mustNotCompile).toHaveLength(4);
  });
});
