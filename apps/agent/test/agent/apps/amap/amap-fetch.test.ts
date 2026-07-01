import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmapError,
  amapFetchImage,
  amapFetchJson,
  redactUrl,
  type AmapFetchOptions,
} from "../../../../src/agent/apps/amap/client/amap-fetch.js";

const FAST: AmapFetchOptions = {
  timeoutMs: 1000,
  maxAttempts: 3,
  backoffBaseMs: 1,
  backoffMaxMs: 2,
};

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function imageResponse(bytes: Buffer, contentType = "image/png"): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => "should-not-be-read",
  } as unknown as Response;
}

function errorPageResponse(payload: unknown): Response {
  const body = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
    },
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => body,
  } as unknown as Response;
}

describe("amapFetchJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns body on infocode 10000", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ infocode: "10000", a: 1 })));
    await expect(amapFetchJson("https://x?key=K", FAST)).resolves.toMatchObject({ a: 1 });
  });

  it("throws AmapError on fatal infocode WITHOUT retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ infocode: "10001", info: "INVALID_USER_KEY" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(amapFetchJson("https://x?key=K", FAST)).rejects.toBeInstanceOf(AmapError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable infocode (QPS) then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ infocode: "10021", info: "CUQPS_HAS_EXCEEDED_THE_LIMIT" }),
      )
      .mockResolvedValueOnce(jsonResponse({ infocode: "10000", ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(amapFetchJson("https://x?key=K", FAST)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a numeric infocode 10000 as success (not fatal)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ infocode: 10000, ok: true })));
    await expect(amapFetchJson("https://x?key=K", FAST)).resolves.toMatchObject({ ok: true });
  });

  it("retries a throttle infocode even when info is Chinese/empty (infocode-set fallback)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ infocode: "10004", info: "并发量已达到上限" }))
      .mockResolvedValueOnce(jsonResponse({ infocode: "10000", ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(amapFetchJson("https://x?key=K", FAST)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("short-circuits on quota infocode (no retry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ infocode: "10003", info: "DAILY_QUERY_OVER_LIMIT" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(amapFetchJson("https://x?key=K", FAST)).rejects.toBeInstanceOf(AmapError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, 429))
      .mockResolvedValueOnce(jsonResponse({ infocode: "10000", ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(amapFetchJson("https://x?key=K", FAST)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("amapFetchImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns bytes + mime when content-type is image/*", async () => {
    const bytes = Buffer.from("PNGDATA");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse(bytes)));
    const result = await amapFetchImage("https://x?key=K", FAST);
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes.toString()).toBe("PNGDATA");
  });

  it("retries a throttle error page (infocode) then returns the image", async () => {
    const bytes = Buffer.from("PNGDATA");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorPageResponse({ infocode: "10004", info: "ACCESS_TOO_FREQUENT" }))
      .mockResolvedValueOnce(imageResponse(bytes));
    vi.stubGlobal("fetch", fetchMock);
    const result = await amapFetchImage("https://x?key=K", FAST);
    expect(result.bytes.toString()).toBe("PNGDATA");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws AmapError (not an image) when content-type is JSON error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          errorPageResponse({ infocode: "20001", info: "MISSING_REQUIRED_PARAMS" }),
        ),
    );
    await expect(amapFetchImage("https://x?key=K", FAST)).rejects.toBeInstanceOf(AmapError);
  });
});

describe("redactUrl", () => {
  it("scrubs key and sig from the URL", () => {
    expect(redactUrl("https://restapi.amap.com/v3/x?key=SECRET&address=a&sig=ZZZ")).toBe(
      "https://restapi.amap.com/v3/x?key=***&address=a&sig=***",
    );
  });
});
