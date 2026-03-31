import type { FastifyInstance } from "fastify";
import { StoryListQuerySchema, StoryListResponseSchema } from "@kagami/shared/schemas/story";
import type { StoryQueryService } from "../application/story-query.service.js";
import { registerQueryRoute } from "../../common/http/route.helper.js";

type StoryHandlerDeps = {
  storyQueryService: StoryQueryService;
};

export class StoryHandler {
  public readonly prefix = "/story";
  private readonly storyQueryService: StoryQueryService;

  public constructor({ storyQueryService }: StoryHandlerDeps) {
    this.storyQueryService = storyQueryService;
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
  }
}
