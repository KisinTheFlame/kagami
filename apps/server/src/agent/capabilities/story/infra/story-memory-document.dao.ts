import type { StoryMemoryDocumentHit, StoryMemoryDocumentKind } from "../domain/story.js";

export interface StoryMemoryDocumentDao {
  replaceForStory(input: {
    storyId: string;
    documents: Array<{
      kind: StoryMemoryDocumentKind;
      content: string;
      embeddingModel: string;
      embeddingDim: number;
      normalizedEmbedding: number[];
    }>;
  }): Promise<void>;
  searchSimilar(input: {
    queryEmbedding: number[];
    topK: number;
  }): Promise<StoryMemoryDocumentHit[]>;
}
