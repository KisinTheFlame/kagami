import {
  type InnerThoughtListQuery,
  type InnerThoughtListResponse,
} from "@kagami/console-api/inner-thought";
import type { InnerThoughtQueryService } from "./inner-thought-query.service.js";
import { mapInnerThoughtList } from "../mappers/inner-thought.mapper.js";
import type { AgentOpsQueryClient } from "./app-log-query.impl.service.js";

type DefaultInnerThoughtQueryServiceDeps = {
  agentOpsQueryClient: AgentOpsQueryClient;
};

/**
 * inner_thought 查询：epic #539 子 issue 4 起 console 不再直读主库，改经 agent 契约路由查询。
 */
export class DefaultInnerThoughtQueryService implements InnerThoughtQueryService {
  private readonly agentOpsQueryClient: AgentOpsQueryClient;

  public constructor({ agentOpsQueryClient }: DefaultInnerThoughtQueryServiceDeps) {
    this.agentOpsQueryClient = agentOpsQueryClient;
  }

  public async queryList(query: InnerThoughtListQuery): Promise<InnerThoughtListResponse> {
    const { total, items } = await this.agentOpsQueryClient.queryInnerThoughts({
      outcome: query.outcome,
      page: query.page,
      pageSize: query.pageSize,
    });

    return mapInnerThoughtList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
