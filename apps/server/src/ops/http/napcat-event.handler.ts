import type { FastifyInstance } from "fastify";
import {
  NapcatEventListQuerySchema,
  NapcatEventListResponseSchema,
} from "@kagami/shared/schemas/napcat-event";
import type { NapcatEventQueryService } from "../application/napcat-event-query.service.js";
import { registerQueryRoute } from "../../common/http/route.helper.js";

type NapcatEventHandlerDeps = {
  napcatEventQueryService: NapcatEventQueryService;
};

export class NapcatEventHandler {
  public readonly prefix = "/napcat-event";
  private readonly napcatEventQueryService: NapcatEventQueryService;

  public constructor({ napcatEventQueryService }: NapcatEventHandlerDeps) {
    this.napcatEventQueryService = napcatEventQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: NapcatEventListQuerySchema,
      responseSchema: NapcatEventListResponseSchema,
      execute: ({ query }) => {
        return this.napcatEventQueryService.queryList(query);
      },
    });
  }
}
