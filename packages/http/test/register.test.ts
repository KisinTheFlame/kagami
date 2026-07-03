import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineBinaryEnvelopeRoute } from "../src/contract.js";
import { registerBinaryEnvelopeRoute, useRawBodyPassthrough } from "../src/register.js";

// registerBinaryEnvelopeRoute 的 headers 通道绑定（issue #324）：声明了 headers 契约时，服务端
// 按同一份 schema 校验入站请求头并以 typed 参数交给 execute；未声明则为 undefined。

const withHeaders = defineBinaryEnvelopeRoute({
  method: "POST",
  path: "/with-headers",
  params: z.object({}),
  bytesIn: false,
  headers: z.object({ "x-thing": z.string().min(1) }),
  output: z.object({ echoed: z.string() }),
});

const noHeaders = defineBinaryEnvelopeRoute({
  method: "POST",
  path: "/no-headers",
  params: z.object({}),
  bytesIn: false,
  output: z.object({ headersWasUndefined: z.boolean() }),
});

let app: FastifyInstance;
let baseUrl: string;

beforeEach(async () => {
  app = Fastify();
  useRawBodyPassthrough(app);

  registerBinaryEnvelopeRoute(app, withHeaders, async ({ headers }) => {
    // headers 是校验后的 typed 值（未知头如 host/content-length 已被 z.object strip）。
    return { echoed: headers["x-thing"] };
  });
  registerBinaryEnvelopeRoute(app, noHeaders, async ({ headers }) => {
    return { headersWasUndefined: headers === undefined };
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await app.close();
});

describe("registerBinaryEnvelopeRoute — headers 通道", () => {
  it("声明了 headers 契约：execute 收到校验后的 typed 请求头", async () => {
    const res = await fetch(`${baseUrl}/with-headers`, {
      method: "POST",
      headers: { "x-thing": "hello" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echoed: "hello" });
  });

  it("未声明 headers 契约：execute 收到的 headers 为 undefined", async () => {
    const res = await fetch(`${baseUrl}/no-headers`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ headersWasUndefined: true });
  });

  it("请求头不合 schema（缺 x-thing）→ 校验失败 500，不进 execute", async () => {
    const res = await fetch(`${baseUrl}/with-headers`, { method: "POST" });
    expect(res.status).toBe(500);
  });
});
