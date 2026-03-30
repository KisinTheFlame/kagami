export type NewsArticleContentStatus = "pending" | "succeeded" | "failed";

export type NewsArticleRecord = {
  id: number;
  sourceKey: string;
  upstreamId: string;
  title: string;
  url: string;
  publishedAt: Date;
  rssSummary: string;
  rssPayload: Record<string, unknown>;
  articleContent: string | null;
  articleContentStatus: NewsArticleContentStatus;
  articleContentFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewsArticleListItem = Pick<
  NewsArticleRecord,
  "id" | "title" | "url" | "publishedAt" | "rssSummary"
>;

export interface NewsArticleDao {
  findBySourceAndUpstreamId(input: {
    sourceKey: string;
    upstreamId: string;
  }): Promise<NewsArticleRecord | null>;
  findById(input: { id: number }): Promise<NewsArticleRecord | null>;
  create(input: {
    sourceKey: string;
    upstreamId: string;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<NewsArticleRecord>;
  updateFeedMetadata(input: {
    id: number;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<NewsArticleRecord>;
  updateArticleContent(input: {
    id: number;
    articleContent: string | null;
    articleContentStatus: NewsArticleContentStatus;
    articleContentFetchedAt: Date | null;
  }): Promise<void>;
  listLatest(input: { sourceKey: string; limit: number }): Promise<NewsArticleListItem[]>;
  listNewerThanCursor(input: {
    sourceKey: string;
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
    limit: number;
  }): Promise<NewsArticleListItem[]>;
  countNewerThanCursor(input: {
    sourceKey: string;
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<number>;
}
