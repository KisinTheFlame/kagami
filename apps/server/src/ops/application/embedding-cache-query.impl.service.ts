import type { EmbeddingCacheListQuery, EmbeddingCacheListResponse } from "@kagami/shared";
import type { EmbeddingCacheDao } from "../../llm/dao/embedding-cache.dao.js";
import { mapEmbeddingCacheList } from "../mappers/embedding-cache.mapper.js";
import type { EmbeddingCacheQueryService } from "./embedding-cache-query.service.js";

type DefaultEmbeddingCacheQueryServiceDeps = {
  embeddingCacheDao: EmbeddingCacheDao;
};

export class DefaultEmbeddingCacheQueryService implements EmbeddingCacheQueryService {
  private readonly embeddingCacheDao: EmbeddingCacheDao;

  public constructor({ embeddingCacheDao }: DefaultEmbeddingCacheQueryServiceDeps) {
    this.embeddingCacheDao = embeddingCacheDao;
  }

  public async queryList(query: EmbeddingCacheListQuery): Promise<EmbeddingCacheListResponse> {
    const filters = {
      provider: query.provider,
      model: query.model,
      taskType: query.taskType,
      outputDimensionality: query.outputDimensionality,
      textHash: query.textHash,
      text: query.text,
      startAt: query.startAt,
      endAt: query.endAt,
    };

    const [total, items] = await Promise.all([
      this.embeddingCacheDao.countByQuery(filters),
      this.embeddingCacheDao.listByQueryPage(query),
    ]);

    return mapEmbeddingCacheList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
