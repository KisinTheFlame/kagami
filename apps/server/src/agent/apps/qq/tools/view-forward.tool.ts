import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { QqApp } from "../qq.app.js";

const ViewForwardArgumentsSchema = z.object({
  forward_id: z.string().trim().min(1),
  offset: z.number().int().nonnegative().optional(),
});

/**
 * 展开查看一条合并转发消息的内容。按需拉取（OneBot get_forward_msg），结果只作为
 * tool result 回到尾部，原始聊天记录不进稳定前缀。默认每页 50 条，靠 offset 翻页。
 */
export class ViewForwardTool extends ZodToolComponent<typeof ViewForwardArgumentsSchema> {
  public readonly name = "view_forward";
  public readonly description =
    "展开查看一条合并转发消息（聊天记录）的内容。forward_id 取自消息里的 [forward_id: xxx] 占位符。默认显示前 50 条；转发更长时用 offset 翻页（如 offset=50 看第 51 条起）。";
  public readonly parameters = {
    type: "object",
    properties: {
      forward_id: {
        type: "string",
        description: "合并转发的 id，来自消息中的 [forward_id: xxx] 占位符。",
      },
      offset: {
        type: "number",
        description: "从第几条开始显示（从 0 起，默认 0）。翻页时填上一页给出的下一段起点，如 50。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ViewForwardArgumentsSchema;
  private readonly getApp: () => QqApp;

  public constructor({ getApp }: { getApp: () => QqApp }) {
    super();
    this.getApp = getApp;
  }

  protected async executeTyped(
    input: z.infer<typeof ViewForwardArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getApp().viewForward(input.forward_id, input.offset ?? 0);
    if (!result.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: result.error,
          note: "拉取合并转发失败。forward_id 是否取自消息里的 [forward_id: xxx]？也可能是该转发已过期不可读。",
        }),
      };
    }
    return { content: result.content ?? "" };
  }
}
