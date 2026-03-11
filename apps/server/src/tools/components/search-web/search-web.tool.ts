import { z } from "zod";
import type {
  WebSearchResult,
  WebSearchResultItem,
  WebSearchService,
} from "../../../service/web-search.service.js";
import { ZodToolComponent, type ToolKind } from "../../core/tool-component.js";

export const SEARCH_WEB_TOOL_NAME = "search_web";
const MAX_AGENT_SOURCES = 3;

const SearchWebArgumentsSchema = z.object({
  query: z.string().trim().min(1),
  topic: z.enum(["general", "news", "finance"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
});

export class SearchWebTool extends ZodToolComponent<typeof SearchWebArgumentsSchema> {
  public readonly name = SEARCH_WEB_TOOL_NAME;
  public readonly description =
    "使用 Tavily 检索互联网信息，适合查最新新闻、背景资料和带来源链接的网页结果。";
  public readonly parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "要搜索的关键词或问题。",
      },
      topic: {
        type: "string",
        description: "搜索主题，可选 general、news、finance。",
      },
      timeRange: {
        type: "string",
        description: "时间范围过滤，可选 day、week、month、year。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SearchWebArgumentsSchema;
  private readonly webSearchService: WebSearchService;

  public constructor({ webSearchService }: { webSearchService: WebSearchService }) {
    super();
    this.webSearchService = webSearchService;
  }

  protected async executeTyped(input: z.infer<typeof SearchWebArgumentsSchema>): Promise<string> {
    const result = await this.webSearchService.search(input);
    return JSON.stringify(formatResultForAgent(result));
  }
}

function formatResultForAgent(result: WebSearchResult): {
  ok: true;
  query: string;
  answer?: string;
  sources: Array<{
    title: string;
    content: string;
    publishedDate?: string;
  }>;
} {
  const uniqueSources = dedupeByUrl(result.results).slice(0, MAX_AGENT_SOURCES);

  return {
    ok: true,
    query: result.query,
    answer: result.answer ? cleanText(result.answer) : undefined,
    sources: uniqueSources.map(source => ({
      title: cleanText(source.title),
      content: cleanText(source.content),
      publishedDate: source.publishedDate,
    })),
  };
}

function dedupeByUrl(results: WebSearchResultItem[]): WebSearchResultItem[] {
  const seen = new Set<string>();
  const deduped: WebSearchResultItem[] = [];

  for (const result of results) {
    const key = normalizeUrl(result.url);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
