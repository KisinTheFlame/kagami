import type { NapcatGroupMessageListQuery, NapcatGroupMessageListResponse } from "@kagami/shared";
import type { NapcatGroupMessageDao } from "../dao/napcat-group-message.dao.js";
import { mapNapcatGroupMessageList } from "../mappers/napcat-group-message.mapper.js";
import type { NapcatGroupMessageQueryService } from "./napcat-group-message-query.service.js";

type DefaultNapcatGroupMessageQueryServiceDeps = {
  napcatGroupMessageDao: NapcatGroupMessageDao;
};

export class DefaultNapcatGroupMessageQueryService implements NapcatGroupMessageQueryService {
  private readonly napcatGroupMessageDao: NapcatGroupMessageDao;

  public constructor({ napcatGroupMessageDao }: DefaultNapcatGroupMessageQueryServiceDeps) {
    this.napcatGroupMessageDao = napcatGroupMessageDao;
  }

  public async queryList(
    query: NapcatGroupMessageListQuery,
  ): Promise<NapcatGroupMessageListResponse> {
    const filters = {
      groupId: query.groupId,
      userId: query.userId,
      nickname: query.nickname,
      keyword: query.keyword,
      startAt: query.startAt,
      endAt: query.endAt,
    };

    const [total, items] = await Promise.all([
      this.napcatGroupMessageDao.countByQuery(filters),
      this.napcatGroupMessageDao.listByQueryPage(query),
    ]);

    return mapNapcatGroupMessageList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
