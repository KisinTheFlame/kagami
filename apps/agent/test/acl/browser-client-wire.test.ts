import { describe, expect, it } from "vitest";
import { HttpBrowserClient } from "../../src/acl/browser-client.js";
import {
  BrowserError,
  serializeBrowserError,
} from "../../src/agent/capabilities/browser/domain/errors.js";

/**
 * Wire 字节基线（issue #230 / #173）：这份测试**先在旧手写 HttpBrowserClient 上跑绿**、再在
 * 契约驱动的实现上原样通过——请求字节（URL/method/body 字符串）、响应对象字段值、错误路径的
 * serializeBrowserError 输出字符串，三层全部逐字节钉死。任何实现更换都不得改动本文件的期望值：
 * 工具层从这些对象字段重新 JSON.stringify 产出 tool_result，字段值不变 ⇒ tool_result 字节不变。
 */

type RecordedRequest = { url: string; method: string | undefined; body: string | undefined };

function fakeFetch(status: number, jsonBody: unknown, recorded: RecordedRequest[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    recorded.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(jsonBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function client(status: number, jsonBody: unknown, recorded: RecordedRequest[]): HttpBrowserClient {
  return new HttpBrowserClient({
    baseUrl: "http://127.0.0.1:20007/",
    fetch: fakeFetch(status, jsonBody, recorded),
  });
}

describe("HttpBrowserClient wire 字节基线：请求", () => {
  it('navigate：POST /navigate + body {"url":...}', async () => {
    const recorded: RecordedRequest[] = [];
    await client(200, { url: "https://a.com/", title: "A" }, recorded).navigate("https://a.com");
    expect(recorded).toEqual([
      {
        url: "http://127.0.0.1:20007/navigate",
        method: "POST",
        body: '{"url":"https://a.com"}',
      },
    ]);
  });

  it("observe / screenshot：POST + body {}", async () => {
    const recorded: RecordedRequest[] = [];
    await client(200, { epoch: 1, url: "u", title: "t", snapshot: "s" }, recorded).observe();
    expect(recorded[0]).toEqual({
      url: "http://127.0.0.1:20007/observe",
      method: "POST",
      body: "{}",
    });

    const recorded2: RecordedRequest[] = [];
    await client(
      200,
      { imageBase64: "", mimeType: "image/jpeg", width: 1, height: 1, url: "u" },
      recorded2,
    ).screenshot();
    expect(recorded2[0]).toEqual({
      url: "http://127.0.0.1:20007/screenshot",
      method: "POST",
      body: "{}",
    });
  });

  it("click / press / eval：POST + 单字段 body", async () => {
    const recorded: RecordedRequest[] = [];
    await client(200, { url: "u" }, recorded).click("7:e3");
    expect(recorded[0]?.body).toBe('{"target":"7:e3"}');

    const recorded2: RecordedRequest[] = [];
    await client(200, {}, recorded2).press("Enter");
    expect(recorded2[0]).toEqual({
      url: "http://127.0.0.1:20007/press",
      method: "POST",
      body: '{"key":"Enter"}',
    });

    const recorded3: RecordedRequest[] = [];
    await client(200, { result: "42" }, recorded3).evaluate("6*7");
    expect(recorded3[0]?.url).toBe("http://127.0.0.1:20007/eval");
    expect(recorded3[0]?.body).toBe('{"script":"6*7"}');
  });

  it("type：value 的 body 字节", async () => {
    const recorded: RecordedRequest[] = [];
    await client(200, { url: "u" }, recorded).type("7:e3", { text: "hi" }, false);
    expect(recorded[0]?.body).toBe('{"target":"7:e3","value":{"text":"hi"},"submit":false}');
  });

  it("waitFor：undefined 字段被 JSON.stringify 丢弃", async () => {
    const recorded: RecordedRequest[] = [];
    await client(200, {}, recorded).waitFor({ selector: undefined, ms: 500 });
    expect(recorded[0]).toEqual({
      url: "http://127.0.0.1:20007/wait-for",
      method: "POST",
      body: '{"ms":500}',
    });
  });

  it("getLocation：GET /location 无 body 无 query", async () => {
    const recorded: RecordedRequest[] = [];
    await client(200, { lastUrl: null, lastTitle: null }, recorded).getLocation();
    expect(recorded[0]).toEqual({
      url: "http://127.0.0.1:20007/location",
      method: "GET",
      body: undefined,
    });
  });
});

describe("HttpBrowserClient wire 字节基线：响应对象字段值", () => {
  it("navigate / click / observe / getLocation / evaluate 返回值与 wire 同构", async () => {
    expect(
      await client(200, { url: "https://a.com/", title: "A" }, []).navigate("https://a.com"),
    ).toEqual({ url: "https://a.com/", title: "A" });

    expect(await client(200, { url: "https://b.com/" }, []).click("7:e3")).toEqual({
      url: "https://b.com/",
    });

    expect(
      await client(200, { epoch: 7, url: "u", title: "t", snapshot: '- link "x"' }, []).observe(),
    ).toEqual({ epoch: 7, url: "u", title: "t", snapshot: '- link "x"' });

    expect(await client(200, { lastUrl: "u", lastTitle: null }, []).getLocation()).toEqual({
      lastUrl: "u",
      lastTitle: null,
    });

    expect(await client(200, { result: "42" }, []).evaluate("6*7")).toBe("42");
  });

  it("screenshot：imageBase64 解码为 Buffer，其余字段原样", async () => {
    const image = Buffer.from("fake-image-bytes");
    const shot = await client(
      200,
      {
        imageBase64: image.toString("base64"),
        mimeType: "image/jpeg",
        width: 1280,
        height: 720,
        url: "https://a.com/",
      },
      [],
    ).screenshot();
    expect(shot.image.equals(image)).toBe(true);
    expect(shot).toMatchObject({
      mimeType: "image/jpeg",
      width: 1280,
      height: 720,
      url: "https://a.com/",
    });
  });
});

describe("HttpBrowserClient wire 字节基线：错误通道（serializeBrowserError 输出字符串）", () => {
  it("非 2xx 带 {code,message,context} → 重建 BrowserError，序列化字节冻结", async () => {
    const c = client(
      409,
      {
        code: "STALE_REF",
        message: "ref 过期",
        context: { ref: "7:e3", epoch: 7, currentEpoch: 9 },
      },
      [],
    );
    const error = await c.click("7:e3").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrowserError);
    expect(serializeBrowserError(error)).toBe(
      '{"ok":false,"error":"STALE_REF","message":"ref 过期","context":{"ref":"7:e3","epoch":7,"currentEpoch":9}}',
    );
  });

  it("非 2xx 无 code → BROWSER_NOT_READY『浏览器服务返回 HTTP <status>』", async () => {
    const error = await client(503, { oops: true }, [])
      .observe()
      .catch((e: unknown) => e);
    expect(serializeBrowserError(error)).toBe(
      '{"ok":false,"error":"BROWSER_NOT_READY","message":"浏览器服务返回 HTTP 503","context":{}}',
    );
  });

  it("fetch 拒绝（不可达/超时）→ BROWSER_NOT_READY 带 cause message", async () => {
    const c = new HttpBrowserClient({
      baseUrl: "http://127.0.0.1:20007",
      fetch: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    });
    const error = await c.navigate("https://a.com").catch((e: unknown) => e);
    expect(serializeBrowserError(error)).toBe(
      '{"ok":false,"error":"BROWSER_NOT_READY","message":"浏览器服务不可达（未启动 / 半开 / 超时）：connect ECONNREFUSED","context":{}}',
    );
  });

  it("2xx 但响应体非 JSON → BROWSER_NOT_READY『无法解析的响应体』", async () => {
    const c = new HttpBrowserClient({
      baseUrl: "http://127.0.0.1:20007",
      fetch: (async () =>
        new Response("half-open garbage", {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    const error = await c.observe().catch((e: unknown) => e);
    expect(serializeBrowserError(error)).toBe(
      '{"ok":false,"error":"BROWSER_NOT_READY","message":"浏览器服务返回了无法解析的响应体","context":{}}',
    );
  });
});
