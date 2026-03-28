import {
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
} from "@kagami/shared/schemas/llm-chat";
import type { LlmChatCallDao } from "../../llm/dao/llm-chat-call.dao.js";
import type { LlmChatCallQueryService } from "./llm-chat-call-query.service.js";
import { mapLlmChatCallList } from "../mappers/llm-chat-call.mapper.js";

type DefaultLlmChatCallQueryServiceDeps = {
  llmChatCallDao: LlmChatCallDao;
};

export class DefaultLlmChatCallQueryService implements LlmChatCallQueryService {
  private readonly llmChatCallDao: LlmChatCallDao;

  public constructor({ llmChatCallDao }: DefaultLlmChatCallQueryServiceDeps) {
    this.llmChatCallDao = llmChatCallDao;
  }

  public async queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse> {
    const [total, items] = await Promise.all([
      this.llmChatCallDao.countByQuery(query),
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
