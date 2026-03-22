import type { FastifyInstance } from "fastify";
import {
  LlmPlaygroundChatRequestSchema,
  LlmPlaygroundChatResponseSchema,
  LlmPlaygroundToolListResponseSchema,
  LlmProviderListResponseSchema,
} from "@kagami/shared";
import { z } from "zod";
import type { LlmPlaygroundService } from "../service/llm-playground.service.js";
import { registerCommandRoute, registerQueryRoute } from "./route.helper.js";

type LlmHandlerDeps = {
  llmPlaygroundService: LlmPlaygroundService;
};

const EmptyQuerySchema = z.object({});

export class LlmHandler {
  public readonly prefix = "/llm";
  private readonly llmPlaygroundService: LlmPlaygroundService;

  public constructor({ llmPlaygroundService }: LlmHandlerDeps) {
    this.llmPlaygroundService = llmPlaygroundService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/providers`,
      querySchema: EmptyQuerySchema,
      responseSchema: LlmProviderListResponseSchema,
      execute: () => {
        return this.llmPlaygroundService.listProviders();
      },
    });

    registerQueryRoute({
      app,
      path: `${this.prefix}/playground-tools`,
      querySchema: EmptyQuerySchema,
      responseSchema: LlmPlaygroundToolListResponseSchema,
      execute: () => {
        return this.llmPlaygroundService.listPlaygroundTools();
      },
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/chat`,
      bodySchema: LlmPlaygroundChatRequestSchema,
      responseSchema: LlmPlaygroundChatResponseSchema,
      execute: ({ body }) => {
        return this.llmPlaygroundService.chat(body);
      },
    });
  }
}
