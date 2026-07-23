import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderHnThreadContent } from "../hn-screen.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { HnReader } from "../hn-reader.js";

const OPEN_HN_THREAD_TOOL_NAME = "open_hn_thread";

const OpenHnThreadArgumentsSchema = z.object({
  id: z.number().int().positive(),
});

type OpenHnThreadToolDeps = {
  getHnReader: () => HnReader;
};

/**
 * 钻进一个 HN story 的讨论：正文 + 最热闹子树优先的限深限量评论树。
 * 外链 story 不抓原文，只呈现讨论（本期不抓外链正文）。
 */
export class OpenHnThreadTool extends ZodToolComponent<typeof OpenHnThreadArgumentsSchema> {
  public readonly name = OPEN_HN_THREAD_TOOL_NAME;
  public readonly description =
    "钻进一个 Hacker News 帖子的讨论，读正文和热门评论。id 来自榜单或搜索结果。只能在 hn App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "要打开的 HN 帖子 id，来自 glance_hn 榜单或 search_hn 搜索结果。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = OpenHnThreadArgumentsSchema;

  private readonly getHnReader: () => HnReader;

  public constructor({ getHnReader }: OpenHnThreadToolDeps) {
    super();
    this.getHnReader = getHnReader;
  }

  protected async executeTyped(
    input: z.infer<typeof OpenHnThreadArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const thread = await this.getHnReader().openThread({ id: input.id });
    if (!thread) {
      return {
        content: JSON.stringify({ ok: false, error: "THREAD_NOT_FOUND" }),
      };
    }
    const content = renderHnThreadContent(thread);
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return {
      content: JSON.stringify({ ok: true }),
      effects,
    };
  }
}
