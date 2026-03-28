import type { FastifyInstance } from "fastify";
import {
  EmbeddingCacheListQuerySchema,
  EmbeddingCacheListResponseSchema,
} from "@kagami/shared/schemas/embedding-cache";
import type { EmbeddingCacheQueryService } from "../application/embedding-cache-query.service.js";
import { registerQueryRoute } from "../../common/http/route.helper.js";

type EmbeddingCacheHandlerDeps = {
  embeddingCacheQueryService: EmbeddingCacheQueryService;
};

export class EmbeddingCacheHandler {
  public readonly prefix = "/embedding-cache";
  private readonly embeddingCacheQueryService: EmbeddingCacheQueryService;

  public constructor({ embeddingCacheQueryService }: EmbeddingCacheHandlerDeps) {
    this.embeddingCacheQueryService = embeddingCacheQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: EmbeddingCacheListQuerySchema,
      responseSchema: EmbeddingCacheListResponseSchema,
      execute: ({ query }) => {
        return this.embeddingCacheQueryService.queryList(query);
      },
    });
  }
}
