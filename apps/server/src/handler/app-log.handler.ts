import type { FastifyInstance } from "fastify";
import { AppLogListQuerySchema, AppLogListResponseSchema } from "@kagami/shared";
import type { AppLogQueryService } from "../service/app-log-query.service.js";
import { registerQueryRoute } from "./route.helper.js";

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
