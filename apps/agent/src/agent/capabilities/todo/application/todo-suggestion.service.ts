import { AppLogger } from "@kagami/kernel/logger/logger";
import { TaskAgentMaxRoundsExceededError, type TaskAgentInvoker } from "@kagami/agent-runtime";
import { isRetryableLlmFailure } from "@kagami/llm-client";
import type { TodoSuggestionTaskInput } from "../task-agent/todo-suggestion-task-agent.js";

const logger = new AppLogger({ source: "todo.suggestion-service" });

/**
 * 一次 digest 里「发现待办」子任务的总尝试次数（含首次）；耗尽仍失败则降级为两段。
 * 底层 llm-client 已按 usage 配置（todoSuggestionAgent: times 3）对每次 chat 做无退避的
 * 立即重试，两层是乘法关系（外层 N × 底层 times 次 provider 调用）——外层只留 2，
 * 专补底层没有的「隔一段再试」，不把最坏调用数推得更高。
 */
const DEFAULT_MAX_ATTEMPTS = 2;

/** 两次尝试之间的固定退避；这是后台 digest，不抢主循环，短退避即可。 */
const DEFAULT_RETRY_BACKOFF_MS = 2_000;

/** 归一化上限：外层重试是补充不是主力，不给配置出「调度器长期占坑」的空间。 */
const MAX_ATTEMPTS_CEILING = 5;

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** 把外部传入的次数/毫秒归一到安全区间（防 Infinity/NaN/负数/小数这类 footgun）。 */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export type TodoSuggestionInput = TodoSuggestionTaskInput;

/**
 * 「发现待办」的重试/降级外壳：真正的 LLM 循环在 TodoSuggestionTaskAgent（工具
 * 装配与主 Agent 字节相等、propose_todos 终止子工具真 dispatch），这里只负责
 * 把它的失败翻译成 digest 能消化的语义。
 *
 * 全程 try/catch：无 provider / 超时 / 跑满轮数未 propose / 结果解析失败 —— 一律
 * 返回 []，绝不 rethrow，让 digest 降级为只发原两段。
 *
 * 重试：只有「真正的调用失败」（provider 不可用 / 上游服务调用失败，判定复用主循环的
 * isRetryableLlmFailure）才会退避后重试，最多 DEFAULT_MAX_ATTEMPTS 次，抹平偶发抖动。
 * 模型行为畸形（跑满 maxRounds 未终止、参数解析失败）属于调用成功但内容不合规，
 * 不重试、直接降级。
 */
export class TodoSuggestionService {
  private readonly taskAgent: TaskAgentInvoker<TodoSuggestionTaskInput, string[]>;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor({
    taskAgent,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
    sleep = defaultSleep,
  }: {
    taskAgent: TaskAgentInvoker<TodoSuggestionTaskInput, string[]>;
    maxAttempts?: number;
    retryBackoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.taskAgent = taskAgent;
    this.maxAttempts = clampInt(maxAttempts, 1, MAX_ATTEMPTS_CEILING, DEFAULT_MAX_ATTEMPTS);
    this.retryBackoffMs = clampInt(retryBackoffMs, 0, 60_000, DEFAULT_RETRY_BACKOFF_MS);
    this.sleep = sleep;
  }

  public async propose(input: TodoSuggestionInput): Promise<string[]> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.taskAgent.invoke(input);
      } catch (error) {
        if (error instanceof TaskAgentMaxRoundsExceededError) {
          // 与 provider 故障区分开：这是「调用成功但模型始终没按约定 propose」，
          // 单独记事件让 digest 静默丢第三段可在日志里归因到模型输出质量。
          logger.info("Todo suggestion task agent exceeded max rounds without proposing", {
            event: "todo.suggestion_max_rounds_exceeded",
            maxRounds: error.maxRounds,
          });
          return [];
        }

        const canRetry = attempt < this.maxAttempts && isRetryableLlmFailure(error);
        logger.warn(
          canRetry
            ? "Failed to propose todo suggestions; will retry"
            : "Failed to propose todo suggestions; digest degrades to two sections",
          {
            event: canRetry ? "todo.suggestion_retry" : "todo.suggestion_failed",
            attempt,
            maxAttempts: this.maxAttempts,
            errorName: error instanceof Error ? error.name : "Error",
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        );
        if (!canRetry) {
          return [];
        }
        await this.sleep(this.retryBackoffMs);
      }
    }
    return [];
  }
}
