import type { FastifyInstance } from "fastify";
import { LlmChatCallListQuerySchema, LlmChatCallListResponseSchema } from "@kagami/shared";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { toLlmChatCallListResponse } from "./llm-chat-call-response.mapper.js";

export class LlmChatCallHandler {
  public readonly prefix = "/llm-chat-call";

  public constructor(private readonly llmChatCallDao: LlmChatCallDao) {}

  public register(app: FastifyInstance): void {
    app.get(`${this.prefix}/query`, async request => {
      const query = LlmChatCallListQuerySchema.parse(request.query);
      const result = await this.llmChatCallDao.listPaginated(query);
      return LlmChatCallListResponseSchema.parse(toLlmChatCallListResponse(result));
    });
  }
}
