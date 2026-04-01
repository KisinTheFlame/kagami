import { z } from "zod";
import type { WebSearchInput, WebSearchResult, WebSearchService } from "./web-search.service.js";

const DEFAULT_BASE_URL = "https://api.tavily.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 400;

const TavilySearchResponseSchema = z.object({
  query: z.string().default(""),
  answer: z.string().optional(),
  response_time: z.number().optional(),
  results: z
    .array(
      z.object({
        title: z.string().default(""),
        url: z.string().trim().min(1),
        content: z.string().default(""),
        score: z.number().optional(),
        published_date: z.string().optional(),
      }),
    )
    .default([]),
});

type TavilyWebSearchServiceDeps = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class TavilyWebSearchService implements WebSearchService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor({
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  }: TavilyWebSearchServiceDeps) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  public async search(input: WebSearchInput): Promise<WebSearchResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query: input.query,
        topic: input.topic ?? "general",
        search_depth: input.searchDepth ?? "advanced",
        max_results: input.maxResults ?? 5,
        include_domains: input.includeDomains,
        exclude_domains: input.excludeDomains,
        time_range: input.timeRange,
        include_answer: "advanced",
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Tavily 请求失败 (${response.status}): ${truncateText(responseText, 200) || "unknown error"}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `Tavily 返回了无法解析的 JSON：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const parsed = TavilySearchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Tavily 返回的数据结构不符合预期");
    }

    return {
      query: parsed.data.query,
      answer: parsed.data.answer,
      responseTime: parsed.data.response_time,
      results: parsed.data.results.map(result => ({
        title: result.title,
        url: result.url,
        content: truncateText(result.content, MAX_CONTENT_LENGTH),
        score: result.score,
        publishedDate: result.published_date,
      })),
    };
  }
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
