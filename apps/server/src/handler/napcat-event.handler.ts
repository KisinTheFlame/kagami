import type { FastifyInstance } from "fastify";
import { NapcatEventListQuerySchema, NapcatEventListResponseSchema } from "@kagami/shared";
import type { NapcatEventQueryService } from "../service/napcat-event-query.service.js";

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
    app.get(`${this.prefix}/query`, async request => {
      const query = NapcatEventListQuerySchema.parse(request.query);
      const result = await this.napcatEventQueryService.queryList(query);
      return NapcatEventListResponseSchema.parse(result);
    });
  }
}
