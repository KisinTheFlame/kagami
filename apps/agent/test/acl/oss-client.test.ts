import { describe, expect, it, vi } from "vitest";
import { HttpOssClient } from "../../src/acl/oss-client.js";

describe("HttpOssClient", () => {
  it("PUTs bytes to /objects and returns the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: "res-42" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new HttpOssClient({ baseUrl: "http://127.0.0.1:20005/", fetch: fetchMock });

    await expect(
      client.putObject({ bytes: Buffer.from("img"), mimeType: "image/png" }),
    ).resolves.toBe("res-42");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:20005/objects");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "image/png" });
  });

  it("throws when OSS responds non-2xx", async () => {
    const client = new HttpOssClient({
      baseUrl: "http://127.0.0.1:20005",
      fetch: vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    });

    await expect(
      client.putObject({ bytes: Buffer.from("x"), mimeType: "image/png" }),
    ).rejects.toMatchObject({ meta: { reason: "OSS_PUT_FAILED" } });
  });

  it("throws when OSS response is missing the key", async () => {
    const client = new HttpOssClient({
      baseUrl: "http://127.0.0.1:20005",
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ),
    });

    await expect(
      client.putObject({ bytes: Buffer.from("x"), mimeType: "image/png" }),
    ).rejects.toMatchObject({ meta: { reason: "OSS_PUT_INVALID_RESPONSE" } });
  });

  it("GETs bytes + mime + size for an existing object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("imgbytes"), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "8" },
      }),
    );
    const client = new HttpOssClient({ baseUrl: "http://127.0.0.1:20005", fetch: fetchMock });

    const result = await client.getObject("res-7");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.size).toBe(8);
    expect(result.bytes.toString()).toBe("imgbytes");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:20005/objects/res-7");
    expect(init.method).toBe("GET");
  });

  it("throws OSS_OBJECT_NOT_FOUND on 404", async () => {
    const client = new HttpOssClient({
      baseUrl: "http://127.0.0.1:20005",
      fetch: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    });

    await expect(client.getObject("res-404")).rejects.toMatchObject({
      meta: { reason: "OSS_OBJECT_NOT_FOUND" },
    });
  });

  it("rejects via content-length before downloading when over maxBytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("x"), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "9999" },
      }),
    );
    const client = new HttpOssClient({ baseUrl: "http://127.0.0.1:20005", fetch: fetchMock });

    await expect(client.getObject("res-big", { maxBytes: 1000 })).rejects.toMatchObject({
      meta: { reason: "OSS_OBJECT_TOO_LARGE", declared: 9999 },
    });
  });

  it("falls back to actual byte count when content-length is missing/under-reports", async () => {
    // content-length 撒谎报小（或缺失），实际字节超限 → 仍按实际字节兜底拒绝。
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.alloc(2000), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "10" },
      }),
    );
    const client = new HttpOssClient({ baseUrl: "http://127.0.0.1:20005", fetch: fetchMock });

    await expect(client.getObject("res-liar", { maxBytes: 1000 })).rejects.toMatchObject({
      meta: { reason: "OSS_OBJECT_TOO_LARGE", actual: 2000 },
    });
  });
});
