import { type AppLogListQuery, type AppLogListResponse } from "@kagami/console-api/app-log";
import type { JsonClient } from "@kagami/rpc-client/client";
import type { observatoryApiContract } from "@kagami/observatory-api/contract";
import type { AppLogQueryService } from "./app-log-query.service.js";
import { mapAppLogList } from "../mappers/app-log.mapper.js";

/** 只依赖用到的那条查询路由，observatory 的告警 / 摄取路由与本查询面无关。 */
export type ObservatoryLogQueryClient = Pick<
  JsonClient<typeof observatoryApiContract>,
  "queryLogs"
>;

type DefaultAppLogQueryServiceDeps = {
  observatoryLogQueryClient: ObservatoryLogQueryClient;
};

/**
 * app_log 查询：epic #539 子 issue 4 起 console 不再直读主库，改经数据属主的契约路由查询；
 * #608 起属主从 agent 换成 observatory（表随之迁库）。console 只做转发聚合，不碰 DB。
 */
export class DefaultAppLogQueryService implements AppLogQueryService {
  private readonly observatoryLogQueryClient: ObservatoryLogQueryClient;

  public constructor({ observatoryLogQueryClient }: DefaultAppLogQueryServiceDeps) {
    this.observatoryLogQueryClient = observatoryLogQueryClient;
  }

  public async queryList(query: AppLogListQuery): Promise<AppLogListResponse> {
    const { total, items } = await this.observatoryLogQueryClient.queryLogs({
      service: query.service,
      level: query.level,
      traceId: query.traceId,
      message: query.message,
      source: query.source,
      startAt: query.startAt,
      endAt: query.endAt,
      page: query.page,
      pageSize: query.pageSize,
    });

    return mapAppLogList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
