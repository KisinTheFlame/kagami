import {
  type NapcatQqMessageListQuery,
  type NapcatQqMessageListResponse,
} from "@kagami/console-api/napcat-group-message";
import { mapNapcatQqMessageList } from "../mappers/napcat-group-message.mapper.js";
import type { NapcatQqMessageQueryService } from "./napcat-group-message-query.service.js";
import type { NapcatQueryClient } from "./napcat-event-query.impl.service.js";

type DefaultNapcatQqMessageQueryServiceDeps = {
  napcatQueryClient: NapcatQueryClient;
};

/**
 * QQ 消息查询：epic #539 子 issue 2 起 console 不再直读共享库，改经 napcat 契约
 * 路由查询（napcat 独占 napcat.db）。console 只做转发聚合，不碰 DB。
 */
export class DefaultNapcatQqMessageQueryService implements NapcatQqMessageQueryService {
  private readonly napcatQueryClient: NapcatQueryClient;

  public constructor({ napcatQueryClient }: DefaultNapcatQqMessageQueryServiceDeps) {
    this.napcatQueryClient = napcatQueryClient;
  }

  public async queryList(query: NapcatQqMessageListQuery): Promise<NapcatQqMessageListResponse> {
    const { total, items } = await this.napcatQueryClient.queryNapcatQqMessages({
      messageType: query.messageType,
      groupId: query.groupId,
      userId: query.userId,
      nickname: query.nickname,
      keyword: query.keyword,
      startAt: query.startAt,
      endAt: query.endAt,
      page: query.page,
      pageSize: query.pageSize,
    });

    return mapNapcatQqMessageList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
