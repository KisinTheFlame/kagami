import { type StoryListQuery, type StoryListResponse } from "@kagami/shared/schemas/story";

export interface StoryQueryService {
  queryList(query: StoryListQuery): Promise<StoryListResponse>;
}
