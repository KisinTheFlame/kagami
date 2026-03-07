import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerCommandRoute, registerQueryRoute } from "../../src/handler/route.helper.js";

describe("route helpers", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("registerQueryRoute should parse query and response", async () => {
    registerQueryRoute({
      app,
      path: "/query",
      querySchema: z.object({
        page: z.coerce.number().int().positive(),
      }),
      responseSchema: z.object({
        ok: z.literal(true),
        page: z.number().int(),
      }),
      execute: ({ query }) => {
        return { ok: true as const, page: query.page };
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/query?page=2",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, page: 2 });
  });

  it("registerQueryRoute should throw ZodError for invalid query", async () => {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          code: "BAD_REQUEST",
        });
      }

      throw error;
    });

    registerQueryRoute({
      app,
      path: "/query",
      querySchema: z.object({
        page: z.coerce.number().int().positive(),
      }),
      responseSchema: z.object({
        ok: z.literal(true),
      }),
      execute: () => ({ ok: true as const }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/query?page=0",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "BAD_REQUEST" });
  });

  it("registerCommandRoute should use default 200 status", async () => {
    registerCommandRoute({
      app,
      path: "/command",
      bodySchema: z.object({
        value: z.string().min(1),
      }),
      responseSchema: z.object({
        echo: z.string(),
      }),
      execute: ({ body }) => {
        return { echo: body.value };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/command",
      payload: { value: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ echo: "hello" });
  });

  it("registerCommandRoute should support custom status code", async () => {
    registerCommandRoute({
      app,
      path: "/command",
      bodySchema: z.object({
        value: z.string().min(1),
      }),
      responseSchema: z.object({
        accepted: z.literal(true),
      }),
      statusCode: 202,
      execute: () => {
        return { accepted: true as const };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/command",
      payload: { value: "hello" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
  });

  it("registerCommandRoute should rethrow error to app error handler", async () => {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof Error) {
        return reply.code(500).send({
          code: "UNHANDLED",
          message: error.message,
        });
      }

      return reply.code(500).send({
        code: "UNHANDLED",
        message: "unknown",
      });
    });

    registerCommandRoute({
      app,
      path: "/command",
      bodySchema: z.object({
        value: z.string().min(1),
      }),
      responseSchema: z.object({
        ok: z.literal(true),
      }),
      execute: () => {
        throw new Error("unmapped");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/command",
      payload: { value: "hello" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "UNHANDLED",
      message: "unmapped",
    });
  });
});
