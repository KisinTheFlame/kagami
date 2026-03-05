import type { FastifyInstance } from "fastify";
import { AppLogListQuerySchema, AppLogListResponseSchema } from "@kagami/shared";
import type { AppLogQueryService } from "../service/app-log-query.service.js";

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
    app.get(`${this.prefix}/query`, async request => {
      const query = AppLogListQuerySchema.parse(request.query);
      const result = await this.appLogQueryService.queryList(query);
      return AppLogListResponseSchema.parse(result);
    });
  }
}
