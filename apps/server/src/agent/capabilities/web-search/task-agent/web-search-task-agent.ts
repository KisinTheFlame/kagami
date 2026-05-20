import { createWebSearchInstructionMessage } from "../../../runtime/context/context-message-factory.js";
import { BaseTaskAgent, type TaskAgentInvoker, type ToolExecutor } from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage } from "../../../../llm/types.js";
import { FINALIZE_WEB_SEARCH_TOOL_NAME } from "./tools/finalize-web-search.tool.js";

export type WebSearchTaskInput = {
  question: string;
  systemPrompt: string;
  contextMessages: LlmMessage[];
};

export type WebSearchAgentInput = WebSearchTaskInput;

export class WebSearchTaskAgent
  extends BaseTaskAgent<WebSearchTaskInput, string, LlmMessage, "webSearchAgent">
  implements TaskAgentInvoker<WebSearchTaskInput, string>
{
  public constructor({
    llmClient,
    taskTools,
    searchTools,
  }: {
    llmClient: LlmClient;
    taskTools?: ToolExecutor<LlmMessage>;
    searchTools?: ToolExecutor<LlmMessage>;
  }) {
    super({
      model: llmClient,
      taskTools: taskTools ?? searchTools ?? failMissingTaskTools(),
      terminalToolNames: [FINALIZE_WEB_SEARCH_TOOL_NAME],
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

function failMissingTaskTools(): never {
  throw new Error("WebSearchTaskAgent requires taskTools");
}
