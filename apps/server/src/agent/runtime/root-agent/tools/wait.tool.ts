import { z } from "zod";
import {
  ZodToolComponent,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { AgentEventQueue } from "../../event/event.queue.js";

export const WAIT_TOOL_NAME = "wait";
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;
export const CONSECUTIVE_WAIT_BLOCK_THRESHOLD = 3;

const WaitArgumentsSchema = z.object({});

export class WaitTool extends ZodToolComponent<typeof WaitArgumentsSchema, LlmMessage> {
  public readonly name = WAIT_TOOL_NAME;
  public readonly description: string;
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = WaitArgumentsSchema;
  private readonly eventQueue: AgentEventQueue;
  private readonly maxWaitMs: number;

  public constructor({
    eventQueue,
    maxWaitMs,
  }: {
    eventQueue: AgentEventQueue;
    maxWaitMs?: number;
  }) {
    super();
    this.eventQueue = eventQueue;
    this.maxWaitMs = maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.description = `在当前状态进入最多 ${formatWaitDuration(this.maxWaitMs)} 的等待，直到新的外部事件出现或等待自然结束。`;
  }

  protected async executeTyped(
    _input: z.infer<typeof WaitArgumentsSchema>,
    context: ToolContext<LlmMessage>,
  ): Promise<ToolExecutionResult> {
    void _input;

    // ToolContext.messages 在工具执行时只包含本轮 assistant message 之前的历史，
    // 当前这次 wait 调用本身还没进消息列表。所以连续次数 = 历史尾部 wait 数 + 1。
    const trailingWaitCount = countTrailingWaitToolCalls(context.messages ?? []);
    const consecutiveWaitCount = trailingWaitCount + 1;
    if (consecutiveWaitCount >= CONSECUTIVE_WAIT_BLOCK_THRESHOLD) {
      return {
        content: buildWaitBlockedContent(consecutiveWaitCount),
      };
    }

    const timerHandle = setTimeout(() => {
      this.eventQueue.enqueue({ type: "wake" });
    }, this.maxWaitMs);

    try {
      await this.eventQueue.waitNonEmpty();
    } finally {
      clearTimeout(timerHandle);
    }

    return {
      content: "休息结束了",
    };
  }
}

export function countTrailingWaitToolCalls(messages: readonly LlmMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    // 跳过 tool result 和 user message：它们是环境状态，不是 Agent 的决策，
    // 不应该打断"连续 wait"的连续性。
    if (message.role !== "assistant") {
      continue;
    }
    if (message.toolCalls.length === 0) {
      // 一次没调任何工具的 assistant 回合也算"做了别的事"——打断连续性。
      return count;
    }
    for (let j = message.toolCalls.length - 1; j >= 0; j--) {
      if (message.toolCalls[j].name === WAIT_TOOL_NAME) {
        count += 1;
      } else {
        return count;
      }
    }
  }
  return count;
}

function buildWaitBlockedContent(consecutiveWaitCount: number): string {
  return [
    "<wait_blocked>",
    `你已经连续选择了 ${consecutiveWaitCount} 次 wait，本次 wait 已被系统短路、没有真的等待。`,
    "你的生活不止有等待 —— 现在请做一件别的事，例如：复盘最近的 story 记忆、看看 IThome 有没有新文章值得评论、主动在群里发起话题，或者整理一下你正在做的事。",
    "</wait_blocked>",
  ].join("\n");
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
