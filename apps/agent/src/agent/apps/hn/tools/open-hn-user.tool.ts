import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderHnUserContent } from "../hn-screen.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { HnReader } from "../hn-reader.js";

export const OPEN_HN_USER_TOOL_NAME = "open_hn_user";

const OpenHnUserArgumentsSchema = z.object({
  username: z.string().min(1),
});

type OpenHnUserToolDeps = {
  getHnReader: () => HnReader;
};

/**
 * 认脸：读某个 HN 用户的主页（karma / about / 注册时长）+ 近期发言。
 */
export class OpenHnUserTool extends ZodToolComponent<typeof OpenHnUserArgumentsSchema> {
  public readonly name = OPEN_HN_USER_TOOL_NAME;
  public readonly description =
    "读一个 Hacker News 用户的主页和近期发言，认识一下这个人。username 来自帖子或评论的作者。只能在 hn App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      username: {
        type: "string",
        description: "HN 用户名，来自某条帖子 / 评论的作者。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = OpenHnUserArgumentsSchema;

  private readonly getHnReader: () => HnReader;

  public constructor({ getHnReader }: OpenHnUserToolDeps) {
    super();
    this.getHnReader = getHnReader;
  }

  protected async executeTyped(
    input: z.infer<typeof OpenHnUserArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getHnReader().openUser({ username: input.username });
    const content = renderHnUserContent(result);
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return {
      content: JSON.stringify({
        ok: true,
        username: result.username,
        found: result.found,
        recentCount: result.recent.length,
      }),
      effects,
    };
  }
}
