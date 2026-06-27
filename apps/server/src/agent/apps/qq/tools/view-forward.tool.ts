import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { FORWARD_ID_DISPLAY_PREFIX } from "../../../../napcat/service/napcat-gateway/shared.js";
import type { QqApp } from "../qq.app.js";

// forward_id 容忍 string | number：占位符带 fwd- 前缀本会强制成字符串，但 LLM 偶尔仍会把它
// 当数字传。收 number 时不静默转换（19 位 id 当 number 已丢精度），而是回明确提示让它纠正。
const ViewForwardArgumentsSchema = z.object({
  forward_id: z.union([z.string().trim().min(1), z.number()]),
  offset: z.number().int().nonnegative().optional(),
});

/**
 * 展开查看一条合并转发消息的内容。按需拉取（OneBot get_forward_msg），结果只作为
 * tool result 回到尾部，原始聊天记录不进稳定前缀。默认每页 50 条，靠 offset 翻页。
 */
export class ViewForwardTool extends ZodToolComponent<typeof ViewForwardArgumentsSchema> {
  public readonly name = "view_forward";
  public readonly description =
    "展开查看一条合并转发消息（聊天记录）的内容。forward_id 取自消息里的 [forward_id: fwd-xxx] 占位符——把 fwd-xxx 原样作为字符串复制进来（含 fwd- 前缀，别当数字）。默认显示前 50 条；转发更长时用 offset 翻页（如 offset=50 看第 51 条起）。";
  public readonly parameters = {
    type: "object",
    properties: {
      forward_id: {
        type: "string",
        description:
          "合并转发的 id，原样复制消息里 [forward_id: fwd-xxx] 的 fwd-xxx（字符串，含 fwd- 前缀，勿当数字传）。",
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
    if (typeof input.forward_id === "number") {
      return {
        content: JSON.stringify({
          ok: false,
          error: "FORWARD_ID_MUST_BE_STRING",
          note: "forward_id 必须按消息里 [forward_id: fwd-xxx] 原样作为字符串传入（含 fwd- 前缀）。它是超长 id，当数字传会丢精度。",
        }),
      };
    }

    const forwardId = stripForwardIdPrefix(input.forward_id);
    const result = await this.getApp().viewForward(forwardId, input.offset ?? 0);
    if (!result.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: result.error,
          note: "拉取合并转发失败。forward_id 是否取自消息里的 [forward_id: fwd-xxx]（含前缀原样复制）？也可能是该转发已过期不可读。",
        }),
      };
    }
    return { content: result.content ?? "" };
  }
}

/** 剥掉占位符里的 fwd- 前缀，拿回真实 res_id；没有前缀则原样返回（兼容裸 id 字符串）。 */
function stripForwardIdPrefix(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith(FORWARD_ID_DISPLAY_PREFIX)
    ? trimmed.slice(FORWARD_ID_DISPLAY_PREFIX.length)
    : trimmed;
}
