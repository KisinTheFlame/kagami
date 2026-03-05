import type { AppLogListQuery, AppLogListResponse } from "@kagami/shared";
import type { LogDao } from "../dao/log.dao.js";
import { mapAppLogList } from "../mappers/app-log.mapper.js";

type AppLogQueryServiceDeps = {
  logDao: LogDao;
};

export class AppLogQueryService {
  private readonly logDao: LogDao;

  public constructor({ logDao }: AppLogQueryServiceDeps) {
    this.logDao = logDao;
  }

  public async queryList(query: AppLogListQuery): Promise<AppLogListResponse> {
    const filters = {
      level: query.level,
      traceId: query.traceId,
      message: query.message,
      source: query.source,
      startAt: query.startAt,
      endAt: query.endAt,
    };

    const [total, items] = await Promise.all([
      this.logDao.countByQuery(filters),
      this.logDao.listByQueryPage(query),
    ]);

    return mapAppLogList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
