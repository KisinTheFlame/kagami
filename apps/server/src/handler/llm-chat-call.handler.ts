import type { FastifyInstance } from "fastify";
import { LlmChatCallListQuerySchema, LlmChatCallListResponseSchema } from "@kagami/shared";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { mapLlmChatCallList } from "../mappers/llm-chat-call.mapper.js";

type LlmChatCallHandlerDeps = {
  llmChatCallDao: LlmChatCallDao;
};

export class LlmChatCallHandler {
  public readonly prefix = "/llm-chat-call";
  private readonly llmChatCallDao: LlmChatCallDao;

  public constructor({ llmChatCallDao }: LlmChatCallHandlerDeps) {
    this.llmChatCallDao = llmChatCallDao;
  }

  public register(app: FastifyInstance): void {
    app.get(`${this.prefix}/query`, async request => {
      const query = LlmChatCallListQuerySchema.parse(request.query);
      const result = await this.llmChatCallDao.listPaginated(query);
      return LlmChatCallListResponseSchema.parse(mapLlmChatCallList(result));
    });
  }
}
