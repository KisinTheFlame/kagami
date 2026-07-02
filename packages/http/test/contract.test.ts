import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineJsonRoute, registerJsonRoute } from "../src/contract.js";

describe("registerJsonRoute", () => {
  it("GET：按 input schema 解析 query，按 output schema 解析返回", async () => {
    const contract = defineJsonRoute({
      method: "GET",
      path: "/echo",
      input: z.object({ name: z.string() }),
      output: z.object({ greeting: z.string() }),
    });
    const app = Fastify();
    registerJsonRoute(
      app,
      contract,
      ({ input }) =>
        ({
          greeting: `hi ${input.name}`,
          // output.parse 应剥掉未声明字段
          extra: "dropped",
        }) as { greeting: string },
    );

    const res = await app.inject({ method: "GET", url: "/echo?name=kagami" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ greeting: "hi kagami" });
    await app.close();
  });

  it("POST：从 body 解析 input", async () => {
    const contract = defineJsonRoute({
      method: "POST",
      path: "/sum",
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.object({ total: z.number() }),
    });
    const app = Fastify();
    registerJsonRoute(app, contract, ({ input }) => ({ total: input.a + input.b }));

    const res = await app.inject({ method: "POST", url: "/sum", payload: { a: 2, b: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 5 });
    await app.close();
  });

  it("input 不合契约 → 500（schema.parse 抛出，交给上层 errorHandler）", async () => {
    const contract = defineJsonRoute({
      method: "POST",
      path: "/strict",
      input: z.object({ n: z.number() }),
      output: z.object({ ok: z.boolean() }),
    });
    const app = Fastify();
    registerJsonRoute(app, contract, () => ({ ok: true }));

    const res = await app.inject({
      method: "POST",
      url: "/strict",
      payload: { n: "not-a-number" },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
