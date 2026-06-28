import type { EmbeddingClient } from "../../../../llm/embedding/client.js";
import type { StoryRecord } from "../domain/story.js";
import { normalizeEmbedding } from "../domain/story.js";
import type { StoryMemoryDocumentDao } from "../infra/story-memory-document.dao.js";
import type { StoryDao } from "../infra/story.dao.js";

export type StoryRecallResult = {
  story: StoryRecord;
  score: number;
  matchedKinds: string[];
};

export class StoryRecallService {
  private readonly storyMemoryDocumentDao: StoryMemoryDocumentDao;
  private readonly storyDao: StoryDao;
  private readonly embeddingClient: EmbeddingClient;
  private readonly embeddingModel: string;
  private readonly outputDimensionality: number;

  public constructor({
    storyMemoryDocumentDao,
    storyDao,
    embeddingClient,
    embeddingModel,
    outputDimensionality,
  }: {
    storyMemoryDocumentDao: StoryMemoryDocumentDao;
    storyDao: StoryDao;
    embeddingClient: EmbeddingClient;
    embeddingModel: string;
    outputDimensionality: number;
  }) {
    this.storyMemoryDocumentDao = storyMemoryDocumentDao;
    this.storyDao = storyDao;
    this.embeddingClient = embeddingClient;
    this.embeddingModel = embeddingModel;
    this.outputDimensionality = outputDimensionality;
  }

  public async search(input: { query: string; topK: number }): Promise<StoryRecallResult[]> {
    const response = await this.embeddingClient.embed({
      content: input.query,
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: this.outputDimensionality,
    });
    const hits = await this.storyMemoryDocumentDao.searchSimilar({
      queryEmbedding: normalizeEmbedding(response.embedding),
      topK: Math.max(input.topK, 1) * 3,
      embeddingModel: this.embeddingModel,
      embeddingDim: this.outputDimensionality,
    });
    const grouped = new Map<
      string,
      {
        score: number;
        matchedKinds: Set<string>;
      }
    >();

    for (const hit of hits) {
      const current = grouped.get(hit.storyId);
      if (!current) {
        grouped.set(hit.storyId, {
          score: hit.score,
          matchedKinds: new Set([hit.kind]),
        });
        continue;
      }

      current.score = Math.max(current.score, hit.score);
      current.matchedKinds.add(hit.kind);
    }

    const orderedIds = [...grouped.entries()]
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, Math.max(1, input.topK))
      .map(([storyId]) => storyId);
    const stories = await this.storyDao.findManyByIds(orderedIds);
    const storyMap = new Map(stories.map(story => [story.id, story]));

    return orderedIds
      .map(storyId => {
        const story = storyMap.get(storyId);
        const hit = grouped.get(storyId);
        if (!story || !hit) {
          return null;
        }

        return {
          story,
          score: hit.score,
          matchedKinds: [...hit.matchedKinds],
        };
      })
      .filter((entry): entry is StoryRecallResult => Boolean(entry));
  }
}
