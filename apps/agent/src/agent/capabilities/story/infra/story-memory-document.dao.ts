import type { StoryMemoryDocumentHit, StoryMemoryDocumentKind } from "../domain/story.js";

export type StoryMemoryDocumentIndexMetadata = {
  storyId: string;
  kind: StoryMemoryDocumentKind;
  embeddingModel: string | null;
  embeddingDim: number | null;
};

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
  findIndexMetadataByStoryIds(storyIds: string[]): Promise<StoryMemoryDocumentIndexMetadata[]>;
  searchSimilar(input: {
    queryEmbedding: number[];
    topK: number;
    embeddingModel: string;
    embeddingDim: number;
  }): Promise<StoryMemoryDocumentHit[]>;
}
