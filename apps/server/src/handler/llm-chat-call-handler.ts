import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";

const LlmChatCallListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export class LlmChatCallHandler {
  public readonly prefix = "/llm-chat-call";

  public constructor(private readonly llmChatCallDao: LlmChatCallDao) {}

  public register(app: FastifyInstance): void {
    app.get(`${this.prefix}/query`, async request => {
      const query = LlmChatCallListQuerySchema.parse(request.query);
      return this.llmChatCallDao.listPaginated(query);
    });
  }
}
