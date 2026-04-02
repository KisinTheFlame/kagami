import {
  type NapcatQqMessageListQuery,
  type NapcatQqMessageListResponse,
} from "@kagami/shared/schemas/napcat-group-message";
import type { NapcatQqMessageDao } from "../../napcat/dao/napcat-group-message.dao.js";
import { mapNapcatQqMessageList } from "../mappers/napcat-group-message.mapper.js";
import type { NapcatQqMessageQueryService } from "./napcat-group-message-query.service.js";

type DefaultNapcatQqMessageQueryServiceDeps = {
  napcatQqMessageDao: NapcatQqMessageDao;
};

export class DefaultNapcatQqMessageQueryService implements NapcatQqMessageQueryService {
  private readonly napcatQqMessageDao: NapcatQqMessageDao;

  public constructor({ napcatQqMessageDao }: DefaultNapcatQqMessageQueryServiceDeps) {
    this.napcatQqMessageDao = napcatQqMessageDao;
  }

  public async queryList(query: NapcatQqMessageListQuery): Promise<NapcatQqMessageListResponse> {
    const filters = {
      messageType: query.messageType,
      groupId: query.groupId,
      userId: query.userId,
      nickname: query.nickname,
      keyword: query.keyword,
      startAt: query.startAt,
      endAt: query.endAt,
    };

    const [total, items] = await Promise.all([
      this.napcatQqMessageDao.countByQuery(filters),
      this.napcatQqMessageDao.listByQueryPage(query),
    ]);

    return mapNapcatQqMessageList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
