import type { FastifyInstance } from "fastify";
import {
  StoryListQuerySchema,
  StoryListResponseSchema,
  StoryReindexRequestSchema,
  StoryReindexResponseSchema,
} from "@kagami/shared/schemas/story";
import { registerCommandRoute, registerQueryRoute } from "@kagami/http/route";
import type { StoryQueryService } from "../application/story-query.service.js";
import type { StoryReindexService } from "../application/story-reindex.service.js";

type StoryHandlerDeps = {
  storyQueryService: StoryQueryService;
  storyReindexService: StoryReindexService;
};

export class StoryHandler {
  public readonly prefix = "/story";
  private readonly storyQueryService: StoryQueryService;
  private readonly storyReindexService: StoryReindexService;

  public constructor({ storyQueryService, storyReindexService }: StoryHandlerDeps) {
    this.storyQueryService = storyQueryService;
    this.storyReindexService = storyReindexService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: StoryListQuerySchema,
      responseSchema: StoryListResponseSchema,
      execute: ({ query }) => {
        return this.storyQueryService.queryList(query);
      },
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/reindex`,
      bodySchema: StoryReindexRequestSchema,
      responseSchema: StoryReindexResponseSchema,
      execute: ({ body }) => {
        return this.storyReindexService.reindex(body);
      },
    });
  }
}
