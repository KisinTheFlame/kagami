export type NewsFeedCursorRecord = {
  sourceKey: string;
  lastSeenArticleId: number;
  lastSeenPublishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export interface NewsFeedCursorDao {
  findBySourceKey(input: { sourceKey: string }): Promise<NewsFeedCursorRecord | null>;
  upsert(input: {
    sourceKey: string;
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<void>;
}
