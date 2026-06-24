import type { LoopAgentExtension } from "@kagami/agent-runtime";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../../../runtime/root-agent/root-agent-runtime.js";
import type { StoryRecallScheduler } from "./story-recall.scheduler.js";

/**
 * StoryRecallExtension：薄壳，仅在每轮 onBeforeRound 给 scheduler 踢一脚。
 *
 * 真实召回逻辑在 StoryRecallScheduler 里异步进行；本扩展不再 await 召回结果。
 * 召回完成会以事件方式回到主 Agent 事件队列，由 session 路由进上下文。
 */
export class StoryRecallExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly scheduler: StoryRecallScheduler;

  public constructor({ scheduler }: { scheduler: StoryRecallScheduler }) {
    this.scheduler = scheduler;
  }

  public onBeforeRound(): void {
    this.scheduler.trigger();
  }

  public onContextCompacted(): void {
    this.scheduler.onContextCompacted();
  }

  public onAfterReset(): void {
    this.scheduler.onAfterReset();
  }
}
