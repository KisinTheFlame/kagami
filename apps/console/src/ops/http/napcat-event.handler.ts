import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { consoleApiContract } from "@kagami/console-api/contract";
import type { NapcatEventQueryService } from "../application/napcat-event-query.service.js";

type NapcatEventHandlerDeps = {
  napcatEventQueryService: NapcatEventQueryService;
};

/** NapCat 事件查询路由。路由与 schema 的单一事实源在 @kagami/console-api（#279 PR4）。 */
export class NapcatEventHandler {
  private readonly napcatEventQueryService: NapcatEventQueryService;

  public constructor({ napcatEventQueryService }: NapcatEventHandlerDeps) {
    this.napcatEventQueryService = napcatEventQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, consoleApiContract.queryNapcatEvents, ({ input }) =>
      this.napcatEventQueryService.queryList(input),
    );
  }
}
