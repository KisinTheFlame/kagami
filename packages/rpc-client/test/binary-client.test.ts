import { BizError } from "@kagami/kernel/errors/biz-error";
import { defineBinaryEnvelopeRoute, defineBinaryRawRoute } from "@kagami/http/contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBinaryClient } from "../src/binary-client.js";
import { notReadyFallbackMapper } from "../src/client.js";

const contracts = {
  putObject: defineBinaryEnvelopeRoute({
    method: "POST",
    path: "/objects",
    params: z.object({}),
    bytesIn: true,
    headers: z.object({ "content-type": z.string().min(1) }),
    output: z.object({ key: z.string().min(1) }),
    statusCode: 201,
  }),
  getObject: defineBinaryRawRoute({
    method: "GET",
    path: "/objects/:key",
    params: z.object({ key: z.string().min(1) }),
    bytesIn: false,
  }),
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createBinaryClient — binary-envelope", () => {
  it("上行字节 + content-type 头，下行按 output.parse 返回", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ key: "res-9" }, 201));
    const client = createBinaryClient(contracts, { baseUrl: "http://svc/", fetch: fetchImpl });

    const result = await client.putObject({
      params: {},
      headers: { "content-type": "image/png" },
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result).toEqual({ key: "res-9" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://svc/objects");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "image/png" });
    expect(init.body).toBeInstanceOf(Uint8Array);
  });

  it("成功判定看 response.ok（200 也算成功，不强校验 statusCode 201）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ key: "res-200" }, 200));
    const client = createBinaryClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    await expect(
      client.putObject({ params: {}, headers: { "content-type": "x/y" }, bytes: new Uint8Array() }),
    ).resolves.toEqual({ key: "res-200" });
  });

  it("非 2xx：decodeError 未接手 → mapFallbackError(bad_status)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const client = createBinaryClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      decodeError: () => undefined,
      mapFallbackError: info =>
        new BizError({ message: "put failed", meta: { reason: "PUT_FAILED", info } }),
    });

    await expect(
      client.putObject({ params: {}, headers: { "content-type": "x/y" }, bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ meta: { reason: "PUT_FAILED", info: { reason: "bad_status" } } });
  });

  it("非 2xx：decodeError 接手 → 抛它返回的错误", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "NOPE" }, 400));
    const client = createBinaryClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      decodeError: (_status, body) => new BizError({ message: "decoded", meta: { body } }),
    });

    await expect(
      client.putObject({ params: {}, headers: { "content-type": "x/y" }, bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ meta: { body: { code: "NOPE" } } });
  });

  it("2xx 但 output 不合 schema（ZodError）→ mapFallbackError(invalid_response_body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 201));
    const client = createBinaryClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      mapFallbackError: info => new BizError({ message: "invalid", meta: { reason: info.reason } }),
    });

    await expect(
      client.putObject({ params: {}, headers: { "content-type": "x/y" }, bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ meta: { reason: "invalid_response_body" } });
  });

  it("网络失败 → mapFallbackError(unreachable)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createBinaryClient(contracts, {
      baseUrl: "http://svc",
      fetch: fetchImpl,
      mapFallbackError: info => new BizError({ message: "down", meta: { reason: info.reason } }),
    });

    await expect(
      client.putObject({ params: {}, headers: { "content-type": "x/y" }, bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ meta: { reason: "unreachable" } });
  });
});

describe("createBinaryClient — binary-raw", () => {
  it("只插值 path + fetch，返回裸 Response（不读 body、不判 status）", async () => {
    const raw = new Response(Buffer.from("bytes"), {
      status: 404,
      headers: { "content-type": "image/png" },
    });
    const fetchImpl = vi.fn().mockResolvedValue(raw);
    const client = createBinaryClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    const response = await client.getObject({ params: { key: "res-7" } });

    // 404 不抛：raw 把裸 Response 原样交回，状态解释归调用方。
    expect(response).toBe(raw);
    expect(response.bodyUsed).toBe(false);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://svc/objects/res-7");
    expect(init.method).toBe("GET");
  });

  it("网络失败原样抛（raw 不 try/catch）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const client = createBinaryClient(contracts, { baseUrl: "http://svc", fetch: fetchImpl });

    await expect(client.getObject({ params: { key: "res-1" } })).rejects.toThrow("boom");
  });
});

describe("notReadyFallbackMapper — 文案字节基线", () => {
  const mapper = notReadyFallbackMapper("测试服务", message => new Error(message));

  it("unreachable：拼 label + cause message", () => {
    const err = mapper({ reason: "unreachable", cause: new Error("ECONNREFUSED") });
    expect(err.message).toBe("测试服务不可达（未启动 / 半开 / 超时）：ECONNREFUSED");
  });

  it("unreachable：非 Error cause 走 String()", () => {
    const err = mapper({ reason: "unreachable", cause: "raw-string" });
    expect(err.message).toBe("测试服务不可达（未启动 / 半开 / 超时）：raw-string");
  });

  it("bad_status：拼 HTTP 状态码", () => {
    const err = mapper({ reason: "bad_status", status: 503 });
    expect(err.message).toBe("测试服务返回 HTTP 503");
  });

  it("invalid_response_body：固定文案", () => {
    const err = mapper({ reason: "invalid_response_body", cause: new Error("x") });
    expect(err.message).toBe("测试服务返回了无法解析的响应体");
  });
});
