export type WebSearchTopic = "general" | "news" | "finance";
export type WebSearchDepth = "basic" | "advanced";
export type WebSearchTimeRange = "day" | "week" | "month" | "year";

export type WebSearchInput = {
  query: string;
  topic?: WebSearchTopic;
  searchDepth?: WebSearchDepth;
  maxResults?: number;
  timeRange?: WebSearchTimeRange;
  includeDomains?: string[];
  excludeDomains?: string[];
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
};

export type WebSearchResult = {
  query: string;
  answer?: string;
  responseTime?: number;
  results: WebSearchResultItem[];
};

export interface WebSearchService {
  search(input: WebSearchInput): Promise<WebSearchResult>;
}
