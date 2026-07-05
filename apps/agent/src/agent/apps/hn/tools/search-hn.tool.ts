import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderHnSearchContent } from "../hn-screen.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { HnReader } from "../hn-reader.js";

const SEARCH_HN_TOOL_NAME = "search_hn";

const SearchHnArgumentsSchema = z.object({
  query: z.string().min(1),
  sort: z.enum(["relevance", "date"]).optional(),
  tags: z.array(z.enum(["story", "comment", "ask_hn", "show_hn"])).optional(),
});

type SearchHnToolDeps = {
  getHnReader: () => HnReader;
};

/**
 * 全文搜索 Hacker News（品味驱动的核心工具）。
 * sort=relevance 按热度，date 按时间；tags 限 story/comment/ask_hn/show_hn。
 */
export class SearchHnTool extends ZodToolComponent<typeof SearchHnArgumentsSchema> {
  public readonly name = SEARCH_HN_TOOL_NAME;
  public readonly description =
    "全文搜索 Hacker News 的帖子和评论，搜你关心的话题。只能在 hn App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词。",
      },
      sort: {
        type: "string",
        enum: ["relevance", "date"],
        description: "relevance 按热度（默认）/ date 按时间倒序。",
      },
      tags: {
        type: "array",
        items: { type: "string", enum: ["story", "comment", "ask_hn", "show_hn"] },
        description: "限定类型：story 帖子 / comment 评论 / ask_hn / show_hn。省略则全搜。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SearchHnArgumentsSchema;

  private readonly getHnReader: () => HnReader;

  public constructor({ getHnReader }: SearchHnToolDeps) {
    super();
    this.getHnReader = getHnReader;
  }

  protected async executeTyped(
    input: z.infer<typeof SearchHnArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getHnReader().searchHn({
      query: input.query,
      sort: input.sort,
      tags: input.tags,
    });
    const content = renderHnSearchContent(result);
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return {
      content: JSON.stringify({ ok: true, query: result.query, count: result.hits.length }),
      effects,
    };
  }
}
