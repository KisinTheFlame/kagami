import type { FastifyInstance } from "fastify";
import { LlmChatCallListQuerySchema, LlmChatCallListResponseSchema } from "@kagami/shared";
import type { LlmChatCallQueryService } from "../service/llm-chat-call-query.service.js";

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
    app.get(`${this.prefix}/query`, async request => {
      const query = LlmChatCallListQuerySchema.parse(request.query);
      const result = await this.llmChatCallQueryService.queryList(query);
      return LlmChatCallListResponseSchema.parse(result);
    });
  }
}
