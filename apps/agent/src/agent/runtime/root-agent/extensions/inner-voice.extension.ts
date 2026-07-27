import type { LoopAgentExtension, ReActRoundResult } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { isWaitToolCall } from "../../../capabilities/inner-voice/domain/idle-detector.js";
import type { InnerVoiceIdleTracker } from "../../../capabilities/inner-voice/domain/idle-tracker.js";
import type {
  InnerVoiceTaskAgent,
  InnerVoiceTaskInput,
} from "../../../capabilities/inner-voice/task-agent/inner-voice-task-agent.js";
import type { AgentEventQueue } from "../../event/event.queue.js";
import { NOOP_METRIC_CLIENT, type MetricClient } from "@kagami/metric-client/client";
import type {
  InnerThoughtDao,
  InnerThoughtOutcome,
} from "@kagami/persistence/dao/inner-thought.dao";
import type { AppCatalogEntryView } from "../app-catalog-view.js";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

/**
 * 内心独白的 metric 埋点（fire-and-forget，摄取失败只丢点）。四个计数刻画一次触发的去向：
 * 摸鱼判定通过 → 注入成功 / 空念头 / 异常。`triggered` 即「防摸鱼触发次数」。
 */
export const INNER_VOICE_METRIC_TRIGGERED = "agent.inner_voice.triggered";
export const INNER_VOICE_METRIC_INJECTED = "agent.inner_voice.injected";
export const INNER_VOICE_METRIC_EMPTY = "agent.inner_voice.empty";
export const INNER_VOICE_METRIC_FAILED = "agent.inner_voice.failed";

const logger = new AppLogger({ source: "agent.inner-voice-extension" });

/**
 * 给 R1 展示多少条近期念头（issue #596）。5→3（issue #601）：这几条原文紧贴指令，条数越多
 * few-shot 引力越强、越容易被当写作范例照抄，而它的用途只是「这些已经想过，绕开」。
 */
const RECENT_THOUGHT_LIMIT = 3;

type InnerVoiceTaskAgentLike = Pick<InnerVoiceTaskAgent, "invoke">;

/**
 * 内心独白 loop extension（issue #265）。挂 onAfterCommit：
 * 1. 把本轮的 wait 调用喂进摸鱼判定 tracker；
 * 2. tracker 判定摸鱼成立时，打 triggered metric，先记一次注入尝试（无论产不产出念头都
 *    消耗配额，防连环空转），再复用主上下文完整 system/消息前缀跑 InnerVoiceTaskAgent
 *    （字节相等命中 KV cache）；
 * 3. 产出非空念头 → enqueue InnerThoughtEvent，经 session 路由装配成 `<inner_impulse>`
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
  private readonly taskAgent: InnerVoiceTaskAgentLike;
  private readonly eventQueue: AgentEventQueue;
  private readonly metricService: MetricClient;
  private readonly innerThoughtDao: Pick<InnerThoughtDao, "insert" | "listRecentInjected">;
  private readonly appCatalogProvider: () => ReadonlyArray<AppCatalogEntryView>;
  private readonly runtimeKey: string;
  private readonly now: () => Date;

  public constructor({
    tracker,
    taskAgent,
    eventQueue,
    metricService,
    innerThoughtDao,
    appCatalogProvider,
    runtimeKey,
    now,
  }: {
    tracker: InnerVoiceIdleTracker;
    taskAgent: InnerVoiceTaskAgentLike;
    eventQueue: AgentEventQueue;
    metricService?: MetricClient;
    innerThoughtDao: Pick<InnerThoughtDao, "insert" | "listRecentInjected">;
    /** App 名单提供者：与 system prompt 共用同一份映射，绝不维护第二份目录（issue #596）。 */
    appCatalogProvider?: () => ReadonlyArray<AppCatalogEntryView>;
    runtimeKey: string;
    now?: () => Date;
  }) {
    this.tracker = tracker;
    this.taskAgent = taskAgent;
    this.eventQueue = eventQueue;
    this.metricService = metricService ?? NOOP_METRIC_CLIENT;
    this.innerThoughtDao = innerThoughtDao;
    this.appCatalogProvider = appCatalogProvider ?? (() => []);
    this.runtimeKey = runtimeKey;
    this.now = now ?? (() => new Date());
  }

  public async onAfterCommit(input: {
    context: RootLoopExtensionContext;
    result: ReActRoundResult<RootAgentCompletion, RootAgentToolExecutionData>;
  }): Promise<void> {
    const committedAt = this.now();
    try {
      for (const execution of input.result.toolExecutions) {
        if (isWaitToolCall(execution.toolCall.name)) {
          this.tracker.recordWait(committedAt);
        }
      }

      if (!this.tracker.shouldTrigger(committedAt)) {
        return;
      }
    } catch (error) {
      // 触发判定前的异常（wait 记录 / shouldTrigger，理论上纯内存不会抛）：不构成一次触发，
      // 故不落行、不记 failed metric，只留诊断。
      logger.errorWithCause("Inner voice idle evaluation failed; skipping", error, {
        event: "agent.inner_voice.evaluation_failed",
      });
      return;
    }

    // 到这里 = 一次触发已成立：打 triggered、消耗配额，无论后续产不产出念头都落一行（issue #359）。
    this.recordMetric(INNER_VOICE_METRIC_TRIGGERED);
    this.tracker.recordAttempt(committedAt);

    let outcome: InnerThoughtOutcome;
    let thought = "";
    try {
      const snapshot = await input.context.host.getContextSnapshot();
      // 复用主 Agent 完整 system / 消息前缀（字节相等命中 KV cache）——不再切片；
      // 隔离由 task agent 的镜像工具集（invoke 只挂 emit_inner_thought）保证。
      // apps / recentThoughts 只进 R1（尾部，用完即弃），不动前缀。
      const invocation: InnerVoiceTaskInput = {
        systemPrompt: snapshot.systemPrompt,
        messages: snapshot.messages,
        apps: this.appCatalogProvider(),
        recentThoughts: await this.loadRecentThoughts(),
      };
      const result = await this.taskAgent.invoke(invocation);
      if (result.length === 0) {
        outcome = "empty";
        this.recordMetric(INNER_VOICE_METRIC_EMPTY);
        logger.info("Inner voice produced no thought this time", {
          event: "agent.inner_voice.empty_thought",
        });
      } else {
        thought = result;
        outcome = "injected";
        this.eventQueue.enqueue({ type: "inner_thought", data: { thought } });
        this.recordMetric(INNER_VOICE_METRIC_INJECTED);
        logger.info("Inner thought enqueued", {
          event: "agent.inner_voice.thought_enqueued",
          thoughtLength: thought.length,
        });
      }
    } catch (error) {
      outcome = "failed";
      this.recordMetric(INNER_VOICE_METRIC_FAILED);
      logger.errorWithCause("Inner voice extension failed; skipping this attempt", error, {
        event: "agent.inner_voice.attempt_failed",
      });
    }

    await this.persistThought({ triggeredAt: committedAt, outcome, thought });
  }

  /**
   * 念头落库（issue #359）。一行一次触发，best-effort：DB 异常只记日志、绝不外抛——
   * 落库是事后账本，不能反过来拖垮主循环或影响念头注入上下文。
   */
  private async persistThought(input: {
    triggeredAt: Date;
    outcome: InnerThoughtOutcome;
    thought: string;
  }): Promise<void> {
    try {
      await this.innerThoughtDao.insert({
        triggeredAt: input.triggeredAt,
        outcome: input.outcome,
        thought: input.thought,
        runtimeKey: this.runtimeKey,
      });
    } catch (error) {
      logger.errorWithCause("Failed to persist inner thought", error, {
        event: "agent.inner_voice.persist_failed",
        outcome: input.outcome,
      });
    }
  }

  /**
   * 取最近几条已注入的念头给 R1 展示（issue #596）。**读库失败必须降级**：这只是给她看个
   * 惯性的锦上添花，绝不能让它把一次内心独白拖成 failed，所以异常就地吞掉、返回空。
   */
  private async loadRecentThoughts(): Promise<readonly string[]> {
    try {
      return await this.innerThoughtDao.listRecentInjected({
        runtimeKey: this.runtimeKey,
        limit: RECENT_THOUGHT_LIMIT,
      });
    } catch (error) {
      logger.errorWithCause(
        "Failed to load recent inner thoughts; continuing without them",
        error,
        {
          event: "agent.inner_voice.recent_load_failed",
        },
      );
      return [];
    }
  }

  private recordMetric(metricName: string): void {
    void this.metricService
      .record({ metricName, value: 1, tags: { runtime: "agent" } })
      .catch(() => undefined);
  }
}
