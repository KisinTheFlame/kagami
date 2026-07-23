import { type AppLogListQuery, type AppLogListResponse } from "@kagami/console-api/app-log";
import type { JsonClient } from "@kagami/rpc-client/client";
import type { agentApiContract } from "@kagami/agent-api/contract";
import type { AppLogQueryService } from "./app-log-query.service.js";
import { mapAppLogList } from "../mappers/app-log.mapper.js";

/** 只依赖用到的三条查询路由，其余 agent 契约（main-agent-context 等）与本查询面无关。 */
export type AgentOpsQueryClient = Pick<
  JsonClient<typeof agentApiContract>,
  "queryAppLogs" | "queryInnerThoughts" | "queryTodos"
>;

type DefaultAppLogQueryServiceDeps = {
  agentOpsQueryClient: AgentOpsQueryClient;
};

/**
 * app_log 查询：epic #539 子 issue 4 起 console 不再直读主库，改经 agent 契约路由查询。
 * console 只做转发聚合，不碰 DB。
 */
export class DefaultAppLogQueryService implements AppLogQueryService {
  private readonly agentOpsQueryClient: AgentOpsQueryClient;

  public constructor({ agentOpsQueryClient }: DefaultAppLogQueryServiceDeps) {
    this.agentOpsQueryClient = agentOpsQueryClient;
  }

  public async queryList(query: AppLogListQuery): Promise<AppLogListResponse> {
    const { total, items } = await this.agentOpsQueryClient.queryAppLogs({
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
