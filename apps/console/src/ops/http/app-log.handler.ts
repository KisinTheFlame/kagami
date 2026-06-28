import type { FastifyInstance } from "fastify";
import { AppLogListQuerySchema, AppLogListResponseSchema } from "@kagami/shared/schemas/app-log";
import type { AppLogQueryService } from "../application/app-log-query.service.js";
import { registerQueryRoute } from "@kagami/server-core/common/http/route.helper";

type AppLogHandlerDeps = {
  appLogQueryService: AppLogQueryService;
};

export class AppLogHandler {
  public readonly prefix = "/app-log";
  private readonly appLogQueryService: AppLogQueryService;

  public constructor({ appLogQueryService }: AppLogHandlerDeps) {
    this.appLogQueryService = appLogQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: AppLogListQuerySchema,
      responseSchema: AppLogListResponseSchema,
      execute: ({ query }) => {
        return this.appLogQueryService.queryList(query);
      },
    });
  }
}
