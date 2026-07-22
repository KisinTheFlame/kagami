import {
  type NapcatEventListQuery,
  type NapcatEventListResponse,
} from "@kagami/console-api/napcat-event";
import type { JsonClient } from "@kagami/rpc-client/client";
import type { napcatApiContract } from "@kagami/napcat-api/contract";
import { mapNapcatEventList } from "../mappers/napcat-event.mapper.js";
import type { NapcatEventQueryService } from "./napcat-event-query.service.js";

/** 只依赖用到的两条查询路由，其余 napcat 契约（发送/群文件等）与 console 无关。 */
export type NapcatQueryClient = Pick<
  JsonClient<typeof napcatApiContract>,
  "queryNapcatEvents" | "queryNapcatQqMessages"
>;

type DefaultNapcatEventQueryServiceDeps = {
  napcatQueryClient: NapcatQueryClient;
};

/**
 * napcat 事件查询：epic #539 子 issue 2 起 console 不再直读共享库，改经 napcat 契约
 * 路由查询（napcat 独占 napcat.db）。console 只做转发聚合，不碰 DB。
 */
export class DefaultNapcatEventQueryService implements NapcatEventQueryService {
  private readonly napcatQueryClient: NapcatQueryClient;

  public constructor({ napcatQueryClient }: DefaultNapcatEventQueryServiceDeps) {
    this.napcatQueryClient = napcatQueryClient;
  }

  public async queryList(query: NapcatEventListQuery): Promise<NapcatEventListResponse> {
    const { total, items } = await this.napcatQueryClient.queryNapcatEvents({
      postType: query.postType,
      messageType: query.messageType,
      userId: query.userId,
      startAt: query.startAt,
      endAt: query.endAt,
      page: query.page,
      pageSize: query.pageSize,
    });

    return mapNapcatEventList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
