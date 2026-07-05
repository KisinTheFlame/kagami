import { z } from "zod";
import {
  TERMINATE_EFFECT_TYPE,
  ZodToolComponent,
  type TerminateEffect,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";

export const EMIT_INNER_THOUGHT_TOOL_NAME = "emit_inner_thought";

const EmitInnerThoughtArgumentsSchema = z.object({
  thought: z.string().default(""),
});

/**
 * InnerVoiceTaskAgent 的终止子工具（对称 propose_todos / finalize_summary）：产
 * `terminate` Effect 让 BaseTaskAgent 退出 invoke 循环；content 是 trim 后的念头，
 * buildResult 再做码点截断。thought 为空字符串即「此刻没什么真想做的」，调用方据此
 * 跳过注入。经主 Agent 镜像工具集的 invoke 挂载，绝不新增顶层工具。
 */
export class EmitInnerThoughtTool extends ZodToolComponent<typeof EmitInnerThoughtArgumentsSchema> {
  public readonly name = EMIT_INNER_THOUGHT_TOOL_NAME;
  public readonly description =
    "提交此刻脑子里冒出来的念头并结束本次内心独白。没什么真想做的就提交空字符串，表示这次什么念头也没有。";
  public readonly parameters = {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "1~3 句第一人称的念头，锚定最近真实经历里的具体人/事/文章；没有就传空字符串。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = EmitInnerThoughtArgumentsSchema;

  protected override formatInvalidArguments(): string {
    return "";
  }

  protected async executeTyped(
    input: z.infer<typeof EmitInnerThoughtArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const content = input.thought.trim();
    const terminate: TerminateEffect = { type: TERMINATE_EFFECT_TYPE, content };
    return {
      content,
      effects: [terminate],
    };
  }
}
