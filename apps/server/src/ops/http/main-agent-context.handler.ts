import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MainAgentContextCompactionResultSchema,
  MainAgentContextSnapshotSchema,
} from "@kagami/shared/schemas/main-agent-context";
import { registerCommandRoute, registerQueryRoute } from "../../common/http/route.helper.js";
import type { MainAgentContextQueryService } from "../application/main-agent-context-query.service.js";

type MainAgentContextHandlerDeps = {
  mainAgentContextQueryService: MainAgentContextQueryService;
};

export class MainAgentContextHandler {
  public readonly prefix = "/main-agent-context";
  private readonly mainAgentContextQueryService: MainAgentContextQueryService;

  public constructor({ mainAgentContextQueryService }: MainAgentContextHandlerDeps) {
    this.mainAgentContextQueryService = mainAgentContextQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/recent`,
      querySchema: z.object({}).strict(),
      responseSchema: MainAgentContextSnapshotSchema,
      execute: async () => {
        return await this.mainAgentContextQueryService.getRecentSnapshot();
      },
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/compact`,
      bodySchema: z.object({}).strict(),
      responseSchema: MainAgentContextCompactionResultSchema,
      execute: async () => {
        return await this.mainAgentContextQueryService.compactEntireContext();
      },
    });
  }
}
