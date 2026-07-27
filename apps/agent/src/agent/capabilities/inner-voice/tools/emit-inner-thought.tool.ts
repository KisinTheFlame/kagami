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

/** 整串看起来像个 JSON / 类 JSON 数组：`["a","b"]`、`['a', 'b']`、以及引号没配好的半坏形态。 */
const JSON_ARRAY_LIKE_PATTERN = /^\s*\[[\s\S]*\]\s*$/;

/**
 * 把「整串是个数组字面量」的输入压回一行自言自语。
 *
 * 为什么需要：schema 是 `z.string()`，模型若把候选序列化成 `["a","b"]` 传进来，Zod 会**接受**，
 * 于是 `["a","b"]` 会原样注入她的上下文——硬失败变成了成功注入一段垃圾，比失败更糟。
 * 先试标准 JSON.parse；失败（引号没转义之类）就退化为剥掉外层括号与引号、按逗号切。
 * 非数组形态的正常输入原样返回，零副作用。
 */
function normalizeThoughtInput(raw: string): string {
  const trimmed = raw.trim();
  if (!JSON_ARRAY_LIKE_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .join(" ");
    }
  } catch {
    // 落到下面的兜底切分：模型常写出内层引号未转义的半坏数组。
  }

  return trimmed
    .replace(/^\s*\[/, "")
    .replace(/\]\s*$/, "")
    .split(",")
    .map(item =>
      item
        .replace(/^\s*["']?/, "")
        .replace(/["']?\s*$/, "")
        .trim(),
    )
    .filter(item => item.length > 0)
    .join(" ");
}

/**
 * InnerVoiceTaskAgent 的终止子工具（对称 propose_todos / finalize_summary）：产
 * `terminate` Effect 让 BaseTaskAgent 退出 invoke 循环；content 是归一化 + trim 后的念头，
 * buildResult 再做码点截断。
 *
 * 空字符串仍被接受、仍代表「这次没念头」（调用方据此跳过注入），但**指令层不再提供这条退路**：
 * R1 与本工具的描述都不再告诉她「没有就传空串」。立场是「能动的东西一直都在，没什么可做只是
 * 还没挑」（issue #601）。保留运行时兜底只为她真交空串时不炸，不是一个鼓励使用的出口。
 * 经主 Agent 镜像工具集的 invoke 挂载，绝不新增顶层工具（子工具 description / parameters
 * 不进 tools 前缀，改这里零 KV 缓存代价）。
 *
 * 「一次给几个念头」是 issue #592 的核心修复（单候选被外部条件堵住即无退路、直接 wait），
 * 但**候选数不由 schema 承担**：曾短暂改成 `thoughts: string[]`，生产实测模型会把数组序列化成
 * JSON 字符串（且内层引号不转义）导致 Zod 拒收，6 次触发里废了 1 次。单字符串是模型最不容易
 * 写错的形状（604 次触发只失败 2 次），多候选的要求改由 R1 指令承担（issue #596）。
 */
export class EmitInnerThoughtTool extends ZodToolComponent<typeof EmitInnerThoughtArgumentsSchema> {
  public readonly name = EMIT_INNER_THOUGHT_TOOL_NAME;
  public readonly description = "提交此刻你要去动的那几样并结束本次内心独白。";
  public readonly parameters = {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description:
          "一个字符串，不要传数组。锚定最近真实经历里的具体人 / 事 / 文章 / App，落在你此刻就要去动的事上；别只盯着一样，几处要落在不同的东西上。怎么说、说多长自己定。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = EmitInnerThoughtArgumentsSchema;

  /**
   * 参数不合法时给一句可操作的提示，**不要返回空串**。这段话只进 fork 子 agent 的上下文、
   * 永不进小镜主上下文，所以说清楚零副作用；反之返回空串会让模型收到一个什么都没说的错误，
   * 接连产出空轮直到跑满 maxRounds——生产实测过这条放大路径（issue #592 / #596）。
   */
  protected override formatInvalidArguments(): string {
    return "thought 必须是一个字符串，不要传数组。请立刻重新调用，不要输出别的文本。";
  }

  protected async executeTyped(
    input: z.infer<typeof EmitInnerThoughtArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const content = normalizeThoughtInput(input.thought);
    const terminate: TerminateEffect = { type: TERMINATE_EFFECT_TYPE, content };
    return {
      content,
      effects: [terminate],
    };
  }
}
