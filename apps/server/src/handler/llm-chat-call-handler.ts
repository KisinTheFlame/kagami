import type { FastifyInstance } from "fastify";
import {
  LlmChatCallListQuerySchema,
  LlmChatCallListResponseSchema,
  type LlmChatCallItem,
} from "@kagami/shared";
import type {
  LlmChatCallDao,
  LlmChatCallItem as LlmChatCallDaoItem,
} from "../dao/llm-chat-call.dao.js";

export class LlmChatCallHandler {
  public readonly prefix = "/llm-chat-call";

  public constructor(private readonly llmChatCallDao: LlmChatCallDao) {}

  public register(app: FastifyInstance): void {
    app.get(`${this.prefix}/query`, async request => {
      const query = LlmChatCallListQuerySchema.parse(request.query);
      const result = await this.llmChatCallDao.listPaginated(query);

      return LlmChatCallListResponseSchema.parse({
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
        items: result.items.map(toLlmChatCallItemDto),
      });
    });
  }
}

function toLlmChatCallItemDto(item: LlmChatCallDaoItem): LlmChatCallItem {
  return {
    id: item.id,
    requestId: item.requestId,
    provider: item.provider,
    model: item.model,
    status: item.status,
    requestPayload: item.requestPayload,
    responsePayload: item.responsePayload,
    error: item.error,
    latencyMs: item.latencyMs,
    createdAt: item.createdAt.toISOString(),
  };
}
