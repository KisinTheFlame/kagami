import type { FastifyInstance } from "fastify";
import {
  LlmChatCallListQuerySchema,
  LlmChatCallListResponseSchema,
} from "@kagami/shared/schemas/llm-chat";
import type { LlmChatCallQueryService } from "../application/llm-chat-call-query.service.js";
import { registerQueryRoute } from "../../common/http/route.helper.js";

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
