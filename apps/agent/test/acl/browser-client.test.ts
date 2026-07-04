import { describe, expect, it, vi } from "vitest";
import { HttpBrowserClient } from "../../src/acl/browser-client.js";
import { BrowserError } from "../../src/agent/capabilities/browser/domain/errors.js";

function clientWith(fetchImpl: typeof fetch): HttpBrowserClient {
  return new HttpBrowserClient({ baseUrl: "http://127.0.0.1:20007", fetch: fetchImpl });
}

describe("HttpBrowserClient", () => {
  it("navigate：成功响应原样返回，POST 到 /navigate 带正确 body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: "https://e.com/", title: "E" }), { status: 200 }),
      );
    const result = await clientWith(fetchImpl as unknown as typeof fetch).navigate("https://e.com");

    expect(result).toEqual({ url: "https://e.com/", title: "E" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:20007/navigate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://e.com" });
  });

  it("非 2xx 的 {code,message,context} 被原样重建成 BrowserError（KV 字节契约）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "NAVIGATION_FAILED",
          message: "导航失败：boom",
          context: { url: "https://e.com" },
        }),
        { status: 422 },
      ),
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).navigate("https://e.com"),
    ).rejects.toMatchObject({
      code: "NAVIGATION_FAILED",
      message: "导航失败：boom",
      contextInfo: { url: "https://e.com" },
    });
  });

  it("连接拒绝/超时（fetch 抛）统一映射成 BROWSER_NOT_READY", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .observe()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserError);
    expect((error as BrowserError).code).toBe("BROWSER_NOT_READY");
  });

  it("非 2xx 但响应体非结构化（无 code）也归一成 BROWSER_NOT_READY", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("502 bad gateway", { status: 502 }));
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .click("7:e3")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserError);
    expect((error as BrowserError).code).toBe("BROWSER_NOT_READY");
  });

  it("2xx 但 body 非 JSON（半开/被截断）→ BROWSER_NOT_READY 而非 BROWSER_ERROR", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>truncated", { status: 200 }));
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .navigate("https://e.com")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserError);
    expect((error as BrowserError).code).toBe("BROWSER_NOT_READY");
  });

  it("screenshot：base64 还原为 Buffer，其余字段透传", async () => {
    const imageBase64 = Buffer.from("shot").toString("base64");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          imageBase64,
          mimeType: "image/jpeg",
          width: 1024,
          height: 768,
          url: "https://e.com",
        }),
        { status: 200 },
      ),
    );
    const shot = await clientWith(fetchImpl as unknown as typeof fetch).screenshot();

    expect(shot.image.equals(Buffer.from("shot"))).toBe(true);
    expect(shot.mimeType).toBe("image/jpeg");
    expect(shot.width).toBe(1024);
    expect(shot.url).toBe("https://e.com");
  });
});
