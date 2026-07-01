import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { LlmClient } from "@kagami/llm-client";
import type { LlmMessage, Tool } from "@kagami/llm-client";
import { createTodoSuggestionInstructionMessage } from "../../../runtime/context/context-message-factory.js";

const logger = new AppLogger({ source: "todo.suggestion-service" });

/** 单次子调用最多采纳的候选待办条数（模型多返回也在此截断）。 */
const MAX_SUGGESTIONS = 5;

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
 */
export class TodoSuggestionService {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: { llmClient: LlmClient }) {
    this.llmClient = llmClient;
  }

  public async propose(input: TodoSuggestionInput): Promise<string[]> {
    try {
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
    } catch (error) {
      logger.warn("Failed to propose todo suggestions; digest degrades to two sections", {
        event: "todo.suggestion_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
