import type { FastifyInstance } from "fastify";
import {
  NapcatQqMessageListQuerySchema,
  NapcatQqMessageListResponseSchema,
} from "@kagami/shared/schemas/napcat-group-message";
import type { NapcatQqMessageQueryService } from "../application/napcat-group-message-query.service.js";
import { registerQueryRoute } from "@kagami/server-core/common/http/route.helper";

type NapcatQqMessageHandlerDeps = {
  napcatQqMessageQueryService: NapcatQqMessageQueryService;
};

export class NapcatQqMessageHandler {
  public readonly prefix = "/napcat-group-message";
  private readonly napcatQqMessageQueryService: NapcatQqMessageQueryService;

  public constructor({ napcatQqMessageQueryService }: NapcatQqMessageHandlerDeps) {
    this.napcatQqMessageQueryService = napcatQqMessageQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: NapcatQqMessageListQuerySchema,
      responseSchema: NapcatQqMessageListResponseSchema,
      execute: ({ query }) => {
        return this.napcatQqMessageQueryService.queryList(query);
      },
    });
  }
}
