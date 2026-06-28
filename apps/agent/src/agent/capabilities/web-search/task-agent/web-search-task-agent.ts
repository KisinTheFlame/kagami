import { createWebSearchInstructionMessage } from "../../../runtime/context/context-message-factory.js";
import { BaseTaskAgent, type TaskAgentInvoker, type ToolExecutor } from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage } from "../../../../llm/types.js";

export type WebSearchTaskInput = {
  question: string;
  systemPrompt: string;
  contextMessages: LlmMessage[];
};

export type WebSearchAgentInput = WebSearchTaskInput;

/**
 * 网页搜索 task agent。
 *
 * 输入：主 Agent 当前 system prompt + 完整消息历史 + 一个自然语言问题。
 * 输出：基于多次搜索整理出的中文摘要字符串。
 *
 * 关键设计：本 agent 复用主 Agent 的 tools / system / messages 前缀（字节相
 * 等），命中 Anthropic prompt cache。隔离手段是顶层工具集中除 invoke 之外
 * 全部走 OutOfScopeTool 软拒绝，invoke 又只挂 webSearchSubtoolOwner（只识别
 * search_web_raw / finalize_web_search），主 Agent session 不会被本 agent
 * 意外触动。
 *
 * 终止条件：LLM 调用 invoke({tool:"finalize_web_search", summary:...})，
 * FinalizeWebSearchTool 产 `terminate` Effect；BaseTaskAgent 检测到 terminate
 * 退出循环，把 finalize 的 content 作为 buildResult 入参。
 */
export class WebSearchTaskAgent
  extends BaseTaskAgent<WebSearchTaskInput, string, "webSearchAgent">
  implements TaskAgentInvoker<WebSearchTaskInput, string>
{
  public constructor({ llmClient, taskTools }: { llmClient: LlmClient; taskTools: ToolExecutor }) {
    super({
      model: llmClient,
      taskTools,
    });
  }

  protected async createInvocation(input: WebSearchTaskInput): Promise<{
    systemPrompt: string;
    messages: LlmMessage[];
    usage: "webSearchAgent";
  }> {
    const question = input.question.trim();
    if (question.length === 0) {
      throw new Error("WebSearchAgent.search requires a non-empty question");
    }

    const systemPrompt = input.systemPrompt.trim();
    if (systemPrompt.length === 0) {
      throw new Error("WebSearchAgent.search requires a non-empty systemPrompt");
    }

    return {
      systemPrompt,
      messages: [...input.contextMessages, createWebSearchInstructionMessage(question)],
      usage: "webSearchAgent",
    };
  }

  protected buildResult({
    content,
  }: {
    input: WebSearchTaskInput;
    messages: LlmMessage[];
    content: string;
  }): string {
    // content 此时是 invoke 的整个 ToolExecutionResult.content（finalize_web_search
    // 的执行结果，被 InvokeTool 透传 / 经过 enrichSubtoolFailureContent 处理）。
    // finalize_web_search 成功返回的就是摘要本身（详见 finalize tool 实现）。
    const summary = content.trim();
    if (summary.length === 0) {
      throw new Error("WebSearchTaskAgent returned an empty summary");
    }

    return summary;
  }

  public async search(input: WebSearchTaskInput): Promise<string> {
    return await this.invoke(input);
  }
}
