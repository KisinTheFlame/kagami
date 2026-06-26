import { describe, expect, it, vi } from "vitest";
import { HttpOssClient } from "../../src/oss/oss-client.js";

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
});
