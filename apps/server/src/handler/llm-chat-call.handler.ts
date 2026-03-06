import type { FastifyInstance } from "fastify";
import { LlmChatCallListQuerySchema, LlmChatCallListResponseSchema } from "@kagami/shared";
import type { LlmChatCallQueryService } from "../service/llm-chat-call-query.service.js";
import { registerQueryRoute } from "./route.helper.js";

type LlmChatCallHandlerDeps = {
  llmChatCallQueryService: LlmChatCallQueryService;
};

export class LlmChatCallHandler {
  public readonly prefix = "/llm-chat-call";
  private readonly llmChatCallQueryService: LlmChatCallQueryService;

  public constructor({ llmChatCallQueryService }: LlmChatCallHandlerDeps) {
    this.llmChatCallQueryService = llmChatCallQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: LlmChatCallListQuerySchema,
      responseSchema: LlmChatCallListResponseSchema,
      execute: ({ query }) => {
        return this.llmChatCallQueryService.queryList(query);
      },
    });
  }
}
