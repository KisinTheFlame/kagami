import type { NapcatEventListQuery, NapcatEventListResponse } from "@kagami/shared";
import type { NapcatEventDao } from "../dao/napcat-event.dao.js";
import { mapNapcatEventList } from "../mappers/napcat-event.mapper.js";
import type { NapcatEventQueryService } from "./napcat-event-query.service.js";

type DefaultNapcatEventQueryServiceDeps = {
  napcatEventDao: NapcatEventDao;
};

export class DefaultNapcatEventQueryService implements NapcatEventQueryService {
  private readonly napcatEventDao: NapcatEventDao;

  public constructor({ napcatEventDao }: DefaultNapcatEventQueryServiceDeps) {
    this.napcatEventDao = napcatEventDao;
  }

  public async queryList(query: NapcatEventListQuery): Promise<NapcatEventListResponse> {
    const filters = {
      postType: query.postType,
      messageType: query.messageType,
      userId: query.userId,
      keyword: query.keyword,
      startAt: query.startAt,
      endAt: query.endAt,
    };

    const [total, items] = await Promise.all([
      this.napcatEventDao.countByQuery(filters),
      this.napcatEventDao.listByQueryPage(query),
    ]);

    return mapNapcatEventList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
