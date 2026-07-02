import type { LoopAgentExtension, ReActRoundResult } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { classifyRootToolCall } from "../../../capabilities/inner-voice/domain/idle-detector.js";
import type { InnerVoiceIdleTracker } from "../../../capabilities/inner-voice/domain/idle-tracker.js";
import { sliceRecentBalancedMessages } from "../../../capabilities/inner-voice/domain/recent-context-slice.js";
import type { InnerVoiceOperation } from "../../../capabilities/inner-voice/operations/inner-voice.operation.js";
import type { AgentEventQueue } from "../../event/event.queue.js";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

/** 喂给 inner-voice Operation 的尾部切片条数：与压缩后典型尾部同量级，素材够用且成本可控。 */
const RECENT_CONTEXT_SLICE_SIZE = 40;

const logger = new AppLogger({ source: "agent.inner-voice-extension" });

type InnerVoiceOperationLike = Pick<InnerVoiceOperation, "execute">;

/**
 * 内心独白 loop extension（issue #265）。挂 onAfterCommit：
 * 1. 把本轮工具调用按 wait / 投入型分类喂进摸鱼判定 tracker；
 * 2. tracker 判定摸鱼成立时，先记一次注入尝试（无论产不产出念头都消耗配额，防连环
 *    空转），再取主上下文尾部切片跑 InnerVoiceOperation；
 * 3. 产出非空念头 → enqueue InnerThoughtEvent，经 session 路由装配成 `<inner_thought>`
 *    追加尾部并触发一轮（enqueue 兼作唤醒——她摸鱼时多半正阻塞在 wait 里）。
 *
 * 一切异常就地吞掉并记日志：内心独白是锦上添花，绝不允许拖垮主循环。
 */
export class InnerVoiceExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly tracker: InnerVoiceIdleTracker;
  private readonly operation: InnerVoiceOperationLike;
  private readonly eventQueue: AgentEventQueue;
  private readonly now: () => Date;

  public constructor({
    tracker,
    operation,
    eventQueue,
    now,
  }: {
    tracker: InnerVoiceIdleTracker;
    operation: InnerVoiceOperationLike;
    eventQueue: AgentEventQueue;
    now?: () => Date;
  }) {
    this.tracker = tracker;
    this.operation = operation;
    this.eventQueue = eventQueue;
    this.now = now ?? (() => new Date());
  }

  public async onAfterCommit(input: {
    context: RootLoopExtensionContext;
    result: ReActRoundResult<RootAgentCompletion, RootAgentToolExecutionData>;
  }): Promise<void> {
    try {
      const committedAt = this.now();
      for (const execution of input.result.toolExecutions) {
        this.tracker.recordToolCall(
          classifyRootToolCall({
            name: execution.toolCall.name,
            argumentsValue: execution.toolCall.arguments,
          }),
          committedAt,
        );
      }

      if (!this.tracker.shouldTrigger(committedAt)) {
        return;
      }
      this.tracker.recordAttempt(committedAt);

      const snapshot = await input.context.host.getContextSnapshot();
      const { thought } = await this.operation.execute({
        systemPrompt: snapshot.systemPrompt,
        messages: sliceRecentBalancedMessages(snapshot.messages, RECENT_CONTEXT_SLICE_SIZE),
      });
      if (thought === null) {
        logger.info("Inner voice produced no thought this time", {
          event: "agent.inner_voice.empty_thought",
        });
        return;
      }

      this.eventQueue.enqueue({ type: "inner_thought", data: { thought } });
      logger.info("Inner thought enqueued", {
        event: "agent.inner_voice.thought_enqueued",
        thoughtLength: thought.length,
      });
    } catch (error) {
      logger.errorWithCause("Inner voice extension failed; skipping this attempt", error, {
        event: "agent.inner_voice.attempt_failed",
      });
    }
  }
}
