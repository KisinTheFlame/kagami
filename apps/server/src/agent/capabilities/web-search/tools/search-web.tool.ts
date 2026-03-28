import { z } from "zod";
import {
  ZodToolComponent,
  type TaskAgentInvoker,
  type ToolContext,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { AgentContext } from "../../../runtime/context/agent-context.js";
import type { WebSearchTaskInput } from "../task-agent/web-search-task-agent.js";

type WebSearchTaskAgentLike =
  | TaskAgentInvoker<WebSearchTaskInput, string>
  | {
      search(input: WebSearchTaskInput): Promise<string>;
    };

export const SEARCH_WEB_TOOL_NAME = "search_web";

const SearchWebArgumentsSchema = z.object({
  question: z.string().trim().min(1),
});

type SearchWebToolContext = ToolContext<LlmMessage> & {
  agentContext?: AgentContext;
};

export class SearchWebTool extends ZodToolComponent<typeof SearchWebArgumentsSchema, LlmMessage> {
  public readonly name = SEARCH_WEB_TOOL_NAME;
  public readonly description =
    "把一个自然语言问题交给网页搜索子 Agent，让它自行拆词、多次检索并返回摘要。";
  public readonly parameters = {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "需要查询的自然语言问题。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SearchWebArgumentsSchema;
  private readonly webSearchTaskAgent: WebSearchTaskAgentLike;

  public constructor({
    webSearchTaskAgent,
    webSearchAgent,
  }: {
    webSearchTaskAgent?: WebSearchTaskAgentLike;
    webSearchAgent?: WebSearchTaskAgentLike;
  }) {
    super();
    this.webSearchTaskAgent =
      webSearchTaskAgent ?? webSearchAgent ?? failMissingWebSearchTaskAgent();
  }

  protected async executeTyped(
    input: z.infer<typeof SearchWebArgumentsSchema>,
    context: ToolContext<LlmMessage>,
  ): Promise<string> {
    const agentContext = (context as SearchWebToolContext).agentContext;

    if (!agentContext) {
      return JSON.stringify({
        ok: false,
        error: "CONTEXT_UNAVAILABLE",
      });
    }

    const forkedContext = await agentContext.fork();
    const snapshot = await forkedContext.getSnapshot();
    const systemPrompt = snapshot.systemPrompt.trim();

    if (!systemPrompt) {
      return JSON.stringify({
        ok: false,
        error: "CONTEXT_UNAVAILABLE",
      });
    }

    const taskInput = {
      question: input.question,
      systemPrompt,
      contextMessages: snapshot.messages,
    };

    if ("invoke" in this.webSearchTaskAgent) {
      return await this.webSearchTaskAgent.invoke(taskInput);
    }

    return await this.webSearchTaskAgent.search(taskInput);
  }
}

function failMissingWebSearchTaskAgent(): never {
  throw new Error("SearchWebTool requires webSearchTaskAgent");
}
