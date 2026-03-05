import type { LlmChatCallListQuery, LlmChatCallListResponse } from "@kagami/shared";
import type { LlmChatCallDao } from "../dao/llm-chat-call.dao.js";
import { mapLlmChatCallList } from "../mappers/llm-chat-call.mapper.js";

type LlmChatCallQueryServiceDeps = {
  llmChatCallDao: LlmChatCallDao;
};

export class LlmChatCallQueryService {
  private readonly llmChatCallDao: LlmChatCallDao;

  public constructor({ llmChatCallDao }: LlmChatCallQueryServiceDeps) {
    this.llmChatCallDao = llmChatCallDao;
  }

  public async queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse> {
    const [total, items] = await Promise.all([
      this.llmChatCallDao.countAll(),
      this.llmChatCallDao.listPage(query),
    ]);

    return mapLlmChatCallList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
