import { type AppLogListQuery, type AppLogListResponse } from "@kagami/console-api/app-log";
import type { LogDao } from "@kagami/kernel/logger/dao/log.dao";
import type { AppLogQueryService } from "./app-log-query.service.js";
import { mapAppLogList } from "../mappers/app-log.mapper.js";

type DefaultAppLogQueryServiceDeps = {
  logDao: LogDao;
};

export class DefaultAppLogQueryService implements AppLogQueryService {
  private readonly logDao: LogDao;

  public constructor({ logDao }: DefaultAppLogQueryServiceDeps) {
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
