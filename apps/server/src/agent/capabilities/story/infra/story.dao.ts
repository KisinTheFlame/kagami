import type { StoryRecord } from "../domain/story.js";

export interface StoryDao {
  create(input: {
    markdown: string;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord>;
  update(input: {
    id: string;
    markdown: string;
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
