import { z } from "zod";
import { BaseTaskAgent, type TaskAgentInvoker, type ToolExecutor } from "@kagami/agent-runtime";
import type { LlmClient, LlmMessage } from "@kagami/llm-client";
import { createTodoSuggestionInstructionMessage } from "../../../runtime/context/context-message-factory.js";

const SuggestionsSchema = z.array(z.string());

export type TodoSuggestionTaskInput = {
  /** fork 出的主 Agent system prompt（复用以命中大段消息前缀）。 */
  systemPrompt: string;
  /** fork 出的主 Agent 消息历史（调用方已隔离，本 agent 只读）。 */
  messages: LlmMessage[];
  /** 当前未完成待办，喂给子任务做去重。 */
  openTodos: { title: string }[];
};

/**
 * 「发现待办」task agent。
 *
 * 输入：主 Agent system prompt + 消息历史 + 未完成待办清单。
 * 输出：候选待办标题数组（最多 5 条，可能为空）。
 *
 * 关键设计：与 SummaryTaskAgent 同构——复用主 Agent 的
 * tools / system / 消息前缀（字节相等），命中 Anthropic prompt cache。隔离手段是
 * 顶层工具集中除 invoke 之外全部走 OutOfScopeTool 软拒绝，invoke 只挂
 * propose_todos 终止子工具。本 agent 不持有 AgentContext 句柄，类型上就无法改动
 * 主上下文。
 *
 * 终止条件：LLM 调用 invoke({tool:"propose_todos", suggestions:[...]})，产
 * `terminate` Effect 退出循环；跑满 maxRounds 仍未终止则抛
 * TaskAgentMaxRoundsExceededError，由 TodoSuggestionService 降级为空建议。
 */
export class TodoSuggestionTaskAgent
  extends BaseTaskAgent<TodoSuggestionTaskInput, string[], "todoSuggestionAgent">
  implements TaskAgentInvoker<TodoSuggestionTaskInput, string[]>
{
  public constructor({ llmClient, taskTools }: { llmClient: LlmClient; taskTools: ToolExecutor }) {
    super({
      model: llmClient,
      taskTools,
      // 正常情况一轮就该 propose；留几轮余量给纯文本轮。
      maxRounds: 4,
    });
  }

  protected async createInvocation(input: TodoSuggestionTaskInput): Promise<{
    systemPrompt: string;
    messages: LlmMessage[];
    usage: "todoSuggestionAgent";
  }> {
    const systemPrompt = input.systemPrompt.trim();
    if (systemPrompt.length === 0) {
      throw new Error("TodoSuggestionTaskAgent requires a non-empty systemPrompt");
    }

    return {
      systemPrompt,
      messages: [...input.messages, createTodoSuggestionInstructionMessage(input.openTodos)],
      usage: "todoSuggestionAgent",
    };
  }

  protected buildResult({
    content,
  }: {
    input: TodoSuggestionTaskInput;
    messages: LlmMessage[];
    content: string;
  }): string[] {
    // content 是 ProposeTodosTool 归一化后 JSON 序列化的标题数组；解析失败视为
    // 畸形，抛给 TodoSuggestionService 走降级路径。
    return SuggestionsSchema.parse(JSON.parse(content));
  }
}
