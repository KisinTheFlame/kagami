export type IthomeFeedCursorRecord = {
  lastSeenArticleId: number;
  lastSeenPublishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export interface IthomeFeedCursorDao {
  find(): Promise<IthomeFeedCursorRecord | null>;
  upsert(input: { lastSeenArticleId: number; lastSeenPublishedAt: Date }): Promise<void>;
}
