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
  thoughts: z.array(z.string()).default([]),
});

/**
 * 多候选之间的分隔符。`TerminateEffect.content` 只能是字符串，而候选本身按 R1 规约都是
 * 「一行以内」的短句，故用换行做无损分隔：buildResult 再按它拆回数组。绝不用空格——念头
 * 内部就有空格，拆不回来。
 */
export const INNER_THOUGHT_DELIMITER = "\n";

/**
 * InnerVoiceTaskAgent 的终止子工具（对称 propose_todos / finalize_summary）：产
 * `terminate` Effect 让 BaseTaskAgent 退出 invoke 循环。
 *
 * 收**多个**候选念头（issue #592）：单候选一旦被外部条件堵住（对方还没回、约好了不能剧透）
 * 或审美上「明天更对」就没有退路、直接 wait，这是实测 68.8% wait 率的三层根因之一。多候选
 * 把「唯一出口被堵」降级成「跳过这条换下一条」。空数组即「此刻没什么真想做的」，调用方据此
 * 跳过注入。经主 Agent 镜像工具集的 invoke 挂载，绝不新增顶层工具（子工具 description /
 * parameters 不进 tools 前缀，改这里零 KV 缓存代价）。
 */
export class EmitInnerThoughtTool extends ZodToolComponent<typeof EmitInnerThoughtArgumentsSchema> {
  public readonly name = EMIT_INNER_THOUGHT_TOOL_NAME;
  public readonly description =
    "提交此刻脑子里同时飘着的那几个念头并结束本次内心独白。真的连一件够得着的都没有，就提交空数组，表示这次什么念头也没有。";
  public readonly parameters = {
    type: "object",
    properties: {
      thoughts: {
        type: "array",
        items: { type: "string" },
        description:
          "2~4 个短句，每句一行以内、第一人称，锚定最近真实经历里的具体人 / 事 / 文章 / App，落在此刻就够得着的事上；几句要落在不同的东西上，别是同一件事的几种说法。一件都没有就传空数组。",
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
    // 逐条 trim 并丢掉空串；全空即空数组 = 没念头。截断留给 buildResult（逐条按码点切）。
    const content = input.thoughts
      .map(thought => thought.trim())
      .filter(thought => thought.length > 0)
      .join(INNER_THOUGHT_DELIMITER);
    const terminate: TerminateEffect = { type: TERMINATE_EFFECT_TYPE, content };
    return {
      content,
      effects: [terminate],
    };
  }
}
