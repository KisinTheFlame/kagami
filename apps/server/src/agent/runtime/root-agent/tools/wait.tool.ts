import { z } from "zod";
import {
  ZodToolComponent,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { RootAgentEffect } from "../../effect/root-agent-effect.js";

export const WAIT_TOOL_NAME = "wait";
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;

const WaitArgumentsSchema = z.object({});

/**
 * 暂停当前 Agent 主循环、等待事件。
 *
 * 返 `wait_for_event` Effect 让 Interpreter 接管挂起语义。工具自己不阻塞、
 * 不持事件队列。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md) 阶段 6。
 */
export class WaitTool extends ZodToolComponent<typeof WaitArgumentsSchema, LlmMessage> {
  public readonly name = WAIT_TOOL_NAME;
  public readonly description: string;
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = WaitArgumentsSchema;
  private readonly maxWaitMs: number;

  public constructor({ maxWaitMs }: { maxWaitMs?: number }) {
    super();
    this.maxWaitMs = maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.description = `在当前状态进入最多 ${formatWaitDuration(this.maxWaitMs)} 的等待，直到新的外部事件出现或等待自然结束。`;
  }

  protected async executeTyped(
    _input: z.infer<typeof WaitArgumentsSchema>,
    _context: ToolContext<LlmMessage>,
  ): Promise<ToolExecutionResult> {
    void _input;

    // 产 wait_for_event Effect。Interpreter 接管阻塞——本工具不再持
    // eventQueue、不再 await waitNonEmpty。content 是占位 tool_result（ReAct 协议
    // 要求每个 tool_call 都跟一个 tool_result）。真正"事件来了"的描述由后续
    // LoopAgent 主循环消费事件时产出（state.handleEvent → append_message）。
    const effects: RootAgentEffect[] = [{ type: "wait_for_event", maxWaitMs: this.maxWaitMs }];
    return {
      content: "休息结束了",
      effects,
    };
  }
}

function formatWaitDuration(durationMs: number): string {
  if (durationMs % 60_000 === 0) {
    return `${durationMs / 60_000} 分钟`;
  }

  if (durationMs % 1_000 === 0) {
    return `${durationMs / 1_000} 秒`;
  }

  return `${durationMs} 毫秒`;
}
