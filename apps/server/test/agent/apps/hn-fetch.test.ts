import { afterEach, describe, expect, it, vi } from "vitest";
import { hnFetchJson, type HnFetchOptions } from "../../../src/agent/apps/hn/client/hn-fetch.js";
import { BizError } from "../../../src/common/errors/biz-error.js";

const FAST_OPTIONS: HnFetchOptions = {
  userAgent: "test-agent",
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
  } as unknown as Response;
}

describe("hnFetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed json on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ hello: "world" })));
    await expect(hnFetchJson("https://x/y.json", FAST_OPTIONS)).resolves.toEqual({
      hello: "world",
    });
  });

  it("returns null literal (HN returns null for missing items)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(null)));
    await expect(hnFetchJson("https://x/item/0.json", FAST_OPTIONS)).resolves.toBeNull();
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(hnFetchJson("https://x", FAST_OPTIONS)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx until attempts exhausted, then throws BizError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(hnFetchJson("https://x", FAST_OPTIONS)).rejects.toBeInstanceOf(BizError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-retryable 4xx (404)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(hnFetchJson("https://x", FAST_OPTIONS)).rejects.toBeInstanceOf(BizError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on network error then throws if never recovers", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(hnFetchJson("https://x", FAST_OPTIONS)).rejects.toBeInstanceOf(BizError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws BizError on malformed json without retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(hnFetchJson("https://x", FAST_OPTIONS)).rejects.toBeInstanceOf(BizError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
