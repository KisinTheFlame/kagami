import type { StoryReindexRequest, StoryReindexResponse } from "@kagami/shared/schemas/story";

export interface StoryReindexService {
  reindex(input: StoryReindexRequest): Promise<StoryReindexResponse>;
}
