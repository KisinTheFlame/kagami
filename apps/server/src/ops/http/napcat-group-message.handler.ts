import type { FastifyInstance } from "fastify";
import {
  NapcatGroupMessageListQuerySchema,
  NapcatGroupMessageListResponseSchema,
} from "@kagami/shared";
import type { NapcatGroupMessageQueryService } from "../application/napcat-group-message-query.service.js";
import { registerQueryRoute } from "../../common/http/route.helper.js";

type NapcatGroupMessageHandlerDeps = {
  napcatGroupMessageQueryService: NapcatGroupMessageQueryService;
};

export class NapcatGroupMessageHandler {
  public readonly prefix = "/napcat-group-message";
  private readonly napcatGroupMessageQueryService: NapcatGroupMessageQueryService;

  public constructor({ napcatGroupMessageQueryService }: NapcatGroupMessageHandlerDeps) {
    this.napcatGroupMessageQueryService = napcatGroupMessageQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: NapcatGroupMessageListQuerySchema,
      responseSchema: NapcatGroupMessageListResponseSchema,
      execute: ({ query }) => {
        return this.napcatGroupMessageQueryService.queryList(query);
      },
    });
  }
}
