import { z } from "zod";
import type { Tool } from "../../llm/types.js";
import type { WebSearchResult, WebSearchResultItem } from "../../service/web-search.service.js";
import type { AgentToolDefinition } from "./index.js";

export const SEARCH_WEB_TOOL_NAME = "search_web";
const MAX_AGENT_SOURCES = 3;

const SearchWebArgumentsSchema = z.object({
  query: z.string().trim().min(1),
  topic: z.enum(["general", "news", "finance"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
});

export const searchWebTool: Tool = {
  name: SEARCH_WEB_TOOL_NAME,
  description: "使用 Tavily 检索互联网信息，适合查最新新闻、背景资料和带来源链接的网页结果。",
  parameters: {
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
  },
};

type CreateSearchWebToolDeps = {
  searchWeb: (input: z.infer<typeof SearchWebArgumentsSchema>) => Promise<WebSearchResult>;
};

export function createSearchWebTool({ searchWeb }: CreateSearchWebToolDeps): AgentToolDefinition {
  return {
    tool: searchWebTool,
    execute: async argumentsValue => ({
      content: await executeSearchWeb(argumentsValue, { searchWeb }),
      shouldFinishRound: false,
    }),
  };
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

async function executeSearchWeb(
  argumentsValue: Record<string, unknown>,
  deps: CreateSearchWebToolDeps,
): Promise<string> {
  const parsed = SearchWebArgumentsSchema.safeParse(argumentsValue);
  if (!parsed.success) {
    return JSON.stringify({
      ok: false,
      error: "INVALID_ARGUMENTS",
      details: parsed.error.issues.map(issue => issue.message),
    });
  }

  try {
    const result = await deps.searchWeb(parsed.data);

    return JSON.stringify(formatResultForAgent(result));
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
