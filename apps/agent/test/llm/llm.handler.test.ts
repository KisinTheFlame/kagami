import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderService } from "../../src/llm/application/llm-provider.service.js";
import { LlmHandler } from "../../src/llm/http/llm.handler.js";

describe("LlmHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should list configured providers", async () => {
    const listProviders = vi.fn().mockResolvedValue({
      providers: [
        {
          id: "openai",
          models: ["gpt-4o-mini"],
        },
      ],
    });
    const llmProviderService: LlmProviderService = {
      listProviders,
    };

    const handler = new LlmHandler({ llmProviderService });
    handler.register(app);

    const response = await app.inject({
      method: "GET",
      url: "/llm/providers",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providers: [
        {
          id: "openai",
          models: ["gpt-4o-mini"],
        },
      ],
    });
    expect(listProviders).toHaveBeenCalledTimes(1);
  });
});
