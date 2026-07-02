import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";

export const EMIT_INNER_THOUGHT_TOOL_NAME = "emit_inner_thought";

const EmitInnerThoughtArgumentsSchema = z.object({
  thought: z.string().default(""),
});

/**
 * 内心独白 Operation 的结构化出口（对称 context-summary 的 SummaryTool）：
 * 强制 toolChoice 指到这里，thought 为空字符串即「此刻没什么真想做的」，
 * 调用方据此跳过注入。只在隔离的 Operation 调用里可见，绝不进主 Agent 工具集。
 */
export class EmitInnerThoughtTool extends ZodToolComponent<typeof EmitInnerThoughtArgumentsSchema> {
  public readonly name = EMIT_INNER_THOUGHT_TOOL_NAME;
  public readonly description =
    "提交此刻脑子里冒出来的念头。没什么真想做的就提交空字符串，表示这次什么念头也没有。";
  public readonly parameters = {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "1~3 句第一人称的念头，锚定最近真实经历里的具体人/事/文章；没有就传空字符串。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = EmitInnerThoughtArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(
    input: z.infer<typeof EmitInnerThoughtArgumentsSchema>,
  ): Promise<string> {
    return input.thought.trim();
  }
}
