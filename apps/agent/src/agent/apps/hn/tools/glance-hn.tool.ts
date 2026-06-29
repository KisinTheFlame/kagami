import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderHnFrontPageContent } from "../hn-screen.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { HnReader } from "../hn-reader.js";

export const GLANCE_HN_TOOL_NAME = "glance_hn";

const GlanceHnArgumentsSchema = z.object({
  feed: z.enum(["top", "new", "best", "ask", "show", "job"]).optional(),
  limit: z.number().int().positive().optional(),
});

type GlanceHnToolDeps = {
  getHnReader: () => HnReader;
};

/**
 * 瞄一眼 Hacker News 某个榜单的 front page。
 *
 * 列表内容走 append_message Effect 追加到上下文尾部；tool_result 只放简短状态。
 */
export class GlanceHnTool extends ZodToolComponent<typeof GlanceHnArgumentsSchema> {
  public readonly name = GLANCE_HN_TOOL_NAME;
  public readonly description =
    "瞄一眼 Hacker News 某个榜单的 front page（标题/分数/评论数）。只能在 hn App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      feed: {
        type: "string",
        enum: ["top", "new", "best", "ask", "show", "job"],
        description:
          "看哪个榜单：top 热榜 / new 最新 / best 最佳 / ask Ask HN / show Show HN / job 招聘。省略默认 top。",
      },
      limit: {
        type: "number",
        description: "看前几条（省略用默认值，超过上限会被截断）。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = GlanceHnArgumentsSchema;

  private readonly getHnReader: () => HnReader;

  public constructor({ getHnReader }: GlanceHnToolDeps) {
    super();
    this.getHnReader = getHnReader;
  }

  protected async executeTyped(
    input: z.infer<typeof GlanceHnArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getHnReader().glanceFeed({
      feed: input.feed ?? "top",
      limit: input.limit,
    });
    const content = renderHnFrontPageContent(result);
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return {
      content: JSON.stringify({ ok: true, feed: result.feed, count: result.stories.length }),
      effects,
    };
  }
}
