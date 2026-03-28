import { z } from "zod";
import type { WebSearchResult, WebSearchService } from "../../../service/web-search.service.js";
import { ZodToolComponent, type ToolKind } from "../../../tools/core/tool-component.js";

export const SEARCH_WEB_RAW_TOOL_NAME = "search_web_raw";

const SearchWebRawArgumentsSchema = z.object({
  query: z.string().trim().min(1),
  topic: z.enum(["general", "news", "finance"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
  includeDomains: z.array(z.string().trim().min(1)).optional(),
  excludeDomains: z.array(z.string().trim().min(1)).optional(),
  maxResults: z.number().int().positive().max(10).optional(),
});

export class SearchWebRawTool extends ZodToolComponent<typeof SearchWebRawArgumentsSchema> {
  public readonly name = SEARCH_WEB_RAW_TOOL_NAME;
  public readonly description =
    "执行一次原始网页搜索。适合对子问题、关键词或限定域名做检索，返回可用于综合的信息与来源。";
  public readonly parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "本次检索的关键词或子问题。",
      },
      topic: {
        type: "string",
        description: "搜索主题，可选 general、news、finance。",
      },
      timeRange: {
        type: "string",
        description: "时间范围过滤，可选 day、week、month、year。",
      },
      includeDomains: {
        type: "array",
        description: "只搜索这些域名，可选。",
        items: {
          type: "string",
        },
      },
      excludeDomains: {
        type: "array",
        description: "排除这些域名，可选。",
        items: {
          type: "string",
        },
      },
      maxResults: {
        type: "number",
        description: "返回结果条数上限，默认 5，最大 10。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SearchWebRawArgumentsSchema;
  private readonly webSearchService: WebSearchService;

  public constructor({ webSearchService }: { webSearchService: WebSearchService }) {
    super();
    this.webSearchService = webSearchService;
  }

  protected async executeTyped(
    input: z.infer<typeof SearchWebRawArgumentsSchema>,
  ): Promise<string> {
    const result = await this.webSearchService.search(input);
    return JSON.stringify(formatRawResult(result));
  }
}

function formatRawResult(result: WebSearchResult): {
  ok: true;
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    publishedDate?: string;
  }>;
} {
  return {
    ok: true,
    query: result.query,
    answer: result.answer ? cleanText(result.answer) : undefined,
    results: result.results.map(item => ({
      title: cleanText(item.title),
      url: item.url,
      content: cleanText(item.content),
      publishedDate: item.publishedDate,
    })),
  };
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
