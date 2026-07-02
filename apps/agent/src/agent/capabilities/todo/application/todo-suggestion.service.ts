import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { LlmClient } from "@kagami/llm-client";
import type { LlmMessage, Tool } from "@kagami/llm-client";
import { createTodoSuggestionInstructionMessage } from "../../../runtime/context/context-message-factory.js";
import { isRetryableLlmFailure } from "../../../runtime/llm-retry.js";

const logger = new AppLogger({ source: "todo.suggestion-service" });

/** 单次子调用最多采纳的候选待办条数（模型多返回也在此截断）。 */
const MAX_SUGGESTIONS = 5;

/**
 * 一次 digest 里「发现待办」子调用的总尝试次数（含首次）；耗尽仍失败则降级为两段。
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

export const PROPOSE_TODOS_TOOL_NAME = "propose_todos";

// 宽松接收：只要 suggestions 是字符串数组即可（空白/空串由 propose 里 trim+filter 兜底剔除）。
// 不做 per-element min 校验——否则模型多给一条空串会让整个数组解析失败、白白丢掉其余好建议。
const ProposeTodosArgsSchema = z.object({
  suggestions: z.array(z.string()).default([]),
});

/**
 * 提交结构化候选待办的输出工具定义。只在本子调用的 tools 里出现（异于主工具集），
 * 因此这次调用整体 cache miss——可接受，理由同 context-summary（隔离 throwaway，
 * 换结构化输出、零解析脆弱、零误触真实工具）。
 */
const PROPOSE_TODOS_TOOL: Tool = {
  name: PROPOSE_TODOS_TOOL_NAME,
  description: "提交你为小镜发现的、具体可执行的候选待办（最多 5 条；没有就提交空数组）。",
  parameters: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: { type: "string" },
        description:
          "候选待办标题，每条一句话、动词开头、具体可执行；不要重复已在未完成清单里的事。",
      },
    },
  },
};

export type TodoSuggestionInput = {
  /** fork 出的主 Agent system prompt（复用以命中大段消息前缀）。 */
  systemPrompt: string;
  /** fork 出的主 Agent 消息历史（调用方已 structuredClone 隔离）。 */
  messages: LlmMessage[];
  /** 当前未完成待办，喂给子调用做去重。 */
  openTodos: { title: string }[];
};

/**
 * 「发现待办」一次性 fork 服务（仿 context-summary 的 summarize）：单次 LLM 调用、无工具循环，
 * 让子调用回顾继承来的主上下文、结合未完成清单去重，产出最多 5 条具体候选待办标题。
 *
 * 关键不变量：本服务**不持有 AgentContext 句柄**，只接收克隆的 messages 数组——类型上就无法
 * append/replace 主上下文，主 Agent 的 KV 缓存前缀不可能被它改动。建议如何回流由调用方决定
 * （本项目里并进 digest 通知、经 NotificationCenter 追加到上下文尾部）。
 *
 * 全程 try/catch：无 provider / 超时 / 无 toolCall / 参数解析失败 / 空 —— 一律返回 []，绝不 rethrow，
 * 让 digest 降级为只发原两段。
 *
 * 重试：只有「真正的调用失败」（provider 不可用 / 上游服务调用失败，判定复用主循环的
 * isRetryableLlmFailure）才会退避后重试，最多 DEFAULT_MAX_ATTEMPTS 次，抹平偶发抖动。
 * 模型返回畸形（无 toolCall / 参数解析失败）属于调用成功但内容不合规，不重试、直接降级；
 * 其它非可重试异常同样立即降级。
 */
export class TodoSuggestionService {
  private readonly llmClient: LlmClient;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor({
    llmClient,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
    sleep = defaultSleep,
  }: {
    llmClient: LlmClient;
    maxAttempts?: number;
    retryBackoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.llmClient = llmClient;
    this.maxAttempts = clampInt(maxAttempts, 1, MAX_ATTEMPTS_CEILING, DEFAULT_MAX_ATTEMPTS);
    this.retryBackoffMs = clampInt(retryBackoffMs, 0, 60_000, DEFAULT_RETRY_BACKOFF_MS);
    this.sleep = sleep;
  }

  public async propose(input: TodoSuggestionInput): Promise<string[]> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.proposeOnce(input);
      } catch (error) {
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

  /**
   * 单次子调用：畸形响应（无 toolCall / 参数解析失败）正常返回 []（调用成功，不触发重试）；
   * chat 抛出的异常向上抛给 propose，由那里按可重试性决定是重试还是降级。
   */
  private async proposeOnce(input: TodoSuggestionInput): Promise<string[]> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.messages, createTodoSuggestionInstructionMessage(input.openTodos)],
        tools: [PROPOSE_TODOS_TOOL],
        toolChoice: { tool_name: PROPOSE_TODOS_TOOL_NAME },
      },
      { usage: "todoSuggestionAgent" },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== PROPOSE_TODOS_TOOL_NAME) {
      return [];
    }

    const parsed = ProposeTodosArgsSchema.safeParse(toolCall.arguments);
    if (!parsed.success) {
      return [];
    }

    return parsed.data.suggestions
      .map(suggestion => suggestion.trim())
      .filter(suggestion => suggestion.length > 0)
      .slice(0, MAX_SUGGESTIONS);
  }
}
