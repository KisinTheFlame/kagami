import type { FastifyInstance } from "fastify";
import { NapcatEventListQuerySchema, NapcatEventListResponseSchema } from "@kagami/shared";
import type { NapcatEventQueryService } from "../service/napcat-event-query.service.js";
import { registerQueryRoute } from "./route.helper.js";

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
