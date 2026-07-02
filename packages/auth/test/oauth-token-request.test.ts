import { afterEach, describe, expect, it, vi } from "vitest";
import { BizError } from "@kagami/kernel/errors/biz-error";
import {
  invalidOAuthTicketError,
  postOAuthTokenRequest,
} from "../src/shared/oauth-token-request.js";

function mockFetchResponse(status: number, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postOAuthTokenRequest — OAuth token POST 共享骨架", () => {
  it("2xx 返回 parsed + rawText，body 按 kind 编码", async () => {
    mockFetchResponse(200, '{"access_token":"a"}');
    const result = await postOAuthTokenRequest<{ access_token?: string }>({
      tokenUrl: "https://example.com/token",
      providerLabel: "Codex",
      body: { kind: "form", params: new URLSearchParams({ grant_type: "refresh_token" }) },
      timeoutMs: 1000,
      unavailableReason: "AUTH_REFRESH_UNAVAILABLE",
    });
    expect(result.parsed).toEqual({ access_token: "a" });
    expect(result.rawText).toBe('{"access_token":"a"}');
    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("400/401/403 →「登录当前不可用」，其余非 2xx →「登录服务调用失败」", async () => {
    mockFetchResponse(401, '{"error":"invalid_grant"}');
    await expect(
      postOAuthTokenRequest({
        tokenUrl: "https://example.com/token",
        providerLabel: "Claude Code",
        body: { kind: "json", payload: { grant_type: "refresh_token" } },
        timeoutMs: 1000,
        unavailableReason: "AUTH_REFRESH_UNAVAILABLE",
      }),
    ).rejects.toThrow("Claude Code 登录当前不可用");

    mockFetchResponse(502, "<html>bad gateway</html>");
    await expect(
      postOAuthTokenRequest({
        tokenUrl: "https://example.com/token",
        providerLabel: "Claude Code",
        body: { kind: "json", payload: {} },
        timeoutMs: 1000,
        unavailableReason: "AUTH_REFRESH_UNAVAILABLE",
      }),
    ).rejects.toThrow("Claude Code 登录服务调用失败");
  });

  it("网络错误归一为「登录服务调用失败」并保留 cause", async () => {
    const boom = new Error("fetch failed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw boom;
      }),
    );
    const caught = await postOAuthTokenRequest({
      tokenUrl: "https://example.com/token",
      providerLabel: "Codex",
      body: { kind: "json", payload: {} },
      timeoutMs: 1000,
      unavailableReason: "AUTH_CODE_EXCHANGE_FAILED",
    }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(BizError);
    expect((caught as BizError).message).toBe("Codex 登录服务调用失败");
    expect((caught as Error).cause).toBe(boom);
  });

  it("非 JSON 响应体 parsed 为 null（交由调用方按无效票据处理）", async () => {
    mockFetchResponse(200, "<html>oops</html>");
    const result = await postOAuthTokenRequest({
      tokenUrl: "https://example.com/token",
      providerLabel: "Codex",
      body: { kind: "json", payload: {} },
      timeoutMs: 1000,
      unavailableReason: "AUTH_REFRESH_UNAVAILABLE",
    });
    expect(result.parsed).toBeNull();
  });
});

describe("invalidOAuthTicketError", () => {
  it("措辞与 reason 保持既有格式", () => {
    const error = invalidOAuthTicketError({ providerLabel: "Codex", cause: { a: 1 } });
    expect(error.message).toBe("Codex 登录服务返回了无效票据");
    expect(error.meta).toMatchObject({ reason: "AUTH_INVALID_RESPONSE" });
  });
});
