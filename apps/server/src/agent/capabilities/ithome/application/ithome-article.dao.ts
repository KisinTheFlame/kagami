export type IthomeArticleContentStatus = "pending" | "succeeded" | "failed";

export type IthomeArticleRecord = {
  id: number;
  upstreamId: string;
  title: string;
  url: string;
  publishedAt: Date;
  rssSummary: string;
  rssPayload: Record<string, unknown>;
  articleContent: string | null;
  articleContentStatus: IthomeArticleContentStatus;
  articleContentFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IthomeArticleListItem = Pick<
  IthomeArticleRecord,
  "id" | "title" | "url" | "publishedAt" | "rssSummary"
>;

export interface IthomeArticleDao {
  findByUpstreamId(input: { upstreamId: string }): Promise<IthomeArticleRecord | null>;
  findById(input: { id: number }): Promise<IthomeArticleRecord | null>;
  create(input: {
    upstreamId: string;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<IthomeArticleRecord>;
  updateFeedMetadata(input: {
    id: number;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<IthomeArticleRecord>;
  updateArticleContent(input: {
    id: number;
    articleContent: string | null;
    articleContentStatus: IthomeArticleContentStatus;
    articleContentFetchedAt: Date | null;
  }): Promise<void>;
  listLatest(input: { limit: number }): Promise<IthomeArticleListItem[]>;
  listNewerThanCursor(input: {
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
    limit: number;
  }): Promise<IthomeArticleListItem[]>;
  countNewerThanCursor(input: {
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<number>;
}
