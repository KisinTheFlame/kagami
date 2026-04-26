import { z } from "zod";
import {
  ZodToolComponent,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { AgentEventQueue } from "../../event/event.queue.js";

export const WAIT_TOOL_NAME = "wait";
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1000;

const WaitArgumentsSchema = z.object({});

export class WaitTool extends ZodToolComponent<typeof WaitArgumentsSchema> {
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
    _context: ToolContext,
  ): Promise<ToolExecutionResult> {
    void _input;
    void _context;

    // Schedule an internal producer that will enqueue a `wake` event after
    // the max wait duration. This is how the tool's "timeout" is expressed:
    // the timer is just another producer on the same queue.
    const timerHandle = setTimeout(() => {
      this.eventQueue.enqueue({ type: "wake" });
    }, this.maxWaitMs);

    try {
      // Block until ANY event arrives in the queue. Could be a real napcat
      // message, an ithome article, a reset-triggered wake, a stop-triggered
      // wake, or our own timer's wake. We don't care which — we just wake up
      // and let the next iteration of the loop drain the queue.
      await this.eventQueue.waitNonEmpty();
    } finally {
      // Always clear the timer: if the loop woke up for any reason other
      // than our timer firing, we don't want a stale setTimeout handle
      // lingering and eventually enqueueing a stray wake event.
      clearTimeout(timerHandle);
    }

    return {
      content: "休息结束了",
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
