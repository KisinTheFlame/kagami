import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LlmChatCallDetailResponseSchema,
  LlmChatCallListQuerySchema,
  LlmChatCallListResponseSchema,
} from "@kagami/shared/schemas/llm-chat";
import type { LlmChatCallQueryService } from "../application/llm-chat-call-query.service.js";
import { registerParamRoute, registerQueryRoute } from "../../common/http/route.helper.js";

const LlmChatCallDetailParamSchema = z.object({
  id: z.preprocess(
    value => (typeof value === "string" ? Number.parseInt(value, 10) : value),
    z.number().int().positive(),
  ),
});

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

    registerParamRoute({
      app,
      path: `${this.prefix}/:id`,
      paramSchema: LlmChatCallDetailParamSchema,
      responseSchema: LlmChatCallDetailResponseSchema,
      execute: ({ params }) => {
        return this.llmChatCallQueryService.getDetail(params.id);
      },
    });
  }
}
