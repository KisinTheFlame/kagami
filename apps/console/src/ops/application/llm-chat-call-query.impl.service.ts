import {
  type LlmChatCallDetailResponse,
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
} from "@kagami/console-api/llm-chat-call";
import type {
  LlmChatCallDao,
  QueryLlmChatCallListInput,
} from "@kagami/persistence/dao/llm-chat-call.dao";
import type { LlmChatCallQueryService } from "./llm-chat-call-query.service.js";
import { mapLlmChatCallDetail, mapLlmChatCallList } from "../mappers/llm-chat-call.mapper.js";
import { BizError } from "@kagami/kernel/errors/biz-error";

type DefaultLlmChatCallQueryServiceDeps = {
  llmChatCallDao: LlmChatCallDao;
};

export class DefaultLlmChatCallQueryService implements LlmChatCallQueryService {
  private readonly llmChatCallDao: LlmChatCallDao;

  public constructor({ llmChatCallDao }: DefaultLlmChatCallQueryServiceDeps) {
    this.llmChatCallDao = llmChatCallDao;
  }

  public async queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse> {
    // wire 的 from/to 是 ISO 串，DAO 收 Date：在此转换（persistence 层保持 Date 洁净）。
    const daoQuery: QueryLlmChatCallListInput = {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.model ? { model: query.model } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    };

    const [total, items] = await Promise.all([
      this.llmChatCallDao.countByQuery(daoQuery),
      this.llmChatCallDao.listPage(daoQuery),
    ]);

    return mapLlmChatCallList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }

  public async getDetail(id: number): Promise<LlmChatCallDetailResponse> {
    const item = await this.llmChatCallDao.findById(id);
    if (item === null) {
      throw new BizError({
        message: "LLM 调用记录不存在",
        meta: {
          reason: "LLM_CHAT_CALL_NOT_FOUND",
          id,
        },
        statusCode: 404,
      });
    }

    return mapLlmChatCallDetail(item);
  }
}
