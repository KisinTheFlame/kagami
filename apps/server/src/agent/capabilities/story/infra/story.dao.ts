import type { Story, StoryRecord } from "../domain/story.js";

export interface StoryDao {
  create(input: {
    payload: Story;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord>;
  update(input: {
    id: string;
    payload: Story;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord>;
  findById(id: string): Promise<StoryRecord | null>;
  findManyByIds(ids: string[]): Promise<StoryRecord[]>;
  countAll(): Promise<number>;
  listPage(input: {
    page: number;
    pageSize: number;
    orderBy: "createdAtAsc" | "createdAtDesc";
  }): Promise<StoryRecord[]>;
}
