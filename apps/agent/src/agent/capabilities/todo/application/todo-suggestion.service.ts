import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { LlmClient } from "@kagami/llm-client";
import type { LlmMessage, Tool } from "@kagami/llm-client";
import { INVOKE_TOOL_NAME } from "../../../runtime/root-agent/tools/invoke.tool.js";
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

// 「虚拟子工具」名:不在任何 InvokeSubtoolOwner 注册,只作为本子调用的约定——指令让模型
// 调 invoke(tool="propose_todos", ...),这里直接读回 arguments,永不真正经 InvokeTool dispatch
// (真 dispatch 会 INVOKE_TOOL_NOT_FOUND)。改动这条路径去别处复用前,先想清楚要不要落成真子工具。
export const PROPOSE_TODOS_TOOL_NAME = "propose_todos";

// 宽松接收：只要 suggestions 是字符串数组即可（空白/空串由 propose 里 trim+filter 兜底剔除）。
// 不做 per-element min 校验——否则模型多给一条空串会让整个数组解析失败、白白丢掉其余好建议。
// invoke 包裹层：模型被要求调用 invoke(tool="propose_todos", suggestions=[...])，
// 这里从 invoke 的 arguments 里取 suggestions（passthrough 透传的业务字段）。tool 字段
// 单独校验，畸形（非 propose_todos）直接降级。
const ProposeTodosArgsSchema = z.object({
  suggestions: z.array(z.string()).default([]),
});

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
  private readonly topLevelToolDefinitions: Tool[];
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor({
    llmClient,
    topLevelToolDefinitions,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
    sleep = defaultSleep,
  }: {
    llmClient: LlmClient;
    /**
     * 主 Agent 每轮实际发送的顶层工具定义（含 invoke 这个 dispatcher）。子调用原样复用它作
     * tools，与主 Agent 字节相等，命中 KV 缓存的 tools / system 前缀层；propose_todos 经
     * invoke 子工具提交，不新增顶层工具、不漂移前缀。
     */
    topLevelToolDefinitions: Tool[];
    maxAttempts?: number;
    retryBackoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.llmClient = llmClient;
    this.topLevelToolDefinitions = topLevelToolDefinitions;
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
        // tools / toolChoice 与主 Agent 每轮完全一致（同一份顶层工具定义 + "required"），
        // 所以 fork 出的 system + tools + 消息前缀能命中主 Agent 的 KV 缓存。propose_todos
        // 不是顶层工具：指令要求模型走 invoke(tool="propose_todos", suggestions=[...]) 提交。
        messages: [...input.messages, createTodoSuggestionInstructionMessage(input.openTodos)],
        tools: this.topLevelToolDefinitions,
        toolChoice: "required",
      },
      { usage: "todoSuggestionAgent" },
    );

    // 只认 invoke(tool="propose_todos", ...)。toolChoice "required" 只保证至少一个工具调用，
    // 模型可能并行发多个（如 switch + invoke），所以按名字找、不假设它在 toolCalls[0]；找不到就
    // 当畸形降级。本子调用不真正 dispatch invoke，直接从其 arguments 取结果。
    const toolCall = response.message.toolCalls.find(
      call => call.name === INVOKE_TOOL_NAME && call.arguments.tool === PROPOSE_TODOS_TOOL_NAME,
    );
    if (!toolCall) {
      // 换 invoke 子工具提交换来了 KV 缓存前缀命中，代价是丢了 provider 侧对 suggestions 的
      // schema 强校验、且 "required" 不保证模型一定选 invoke。这里显式记一条：把「模型没按约定
      // 走 invoke(propose_todos)」和「确实没有建议」区分开，让 digest 静默丢第三段可在日志里定位。
      logger.info("Todo suggestion sub-call did not submit via invoke(propose_todos); degrading", {
        event: "todo.suggestion_no_proposal",
        toolNames: response.message.toolCalls.map(call => call.name),
      });
      return [];
    }

    const parsed = ProposeTodosArgsSchema.safeParse(toolCall.arguments);
    if (!parsed.success) {
      // 走了 invoke(propose_todos) 但 suggestions 字段畸形（缺失/非字符串数组）——同样区分于
      // 「确实空」，落一条便于观测模型输出质量。
      logger.info("Todo suggestion invoke args failed schema parse; degrading", {
        event: "todo.suggestion_parse_failed",
      });
      return [];
    }

    return parsed.data.suggestions
      .map(suggestion => suggestion.trim())
      .filter(suggestion => suggestion.length > 0)
      .slice(0, MAX_SUGGESTIONS);
  }
}
