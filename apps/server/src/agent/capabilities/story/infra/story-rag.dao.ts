import type { StoryRagHit, StoryRagKind } from "../domain/story.js";

export interface StoryRagDao {
  replaceForStory(input: {
    storyId: string;
    documents: Array<{
      kind: StoryRagKind;
      content: string;
      embeddingModel: string;
      embeddingDim: number;
      normalizedEmbedding: number[];
    }>;
  }): Promise<void>;
  searchSimilar(input: { queryEmbedding: number[]; topK: number }): Promise<StoryRagHit[]>;
}
