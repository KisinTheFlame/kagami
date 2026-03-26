import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "../../core/tool-component.js";

export const SEARCH_WEB_TOOL_NAME = "search_web";

const SearchWebArgumentsSchema = z.object({
  question: z.string().trim().min(1),
});

export class SearchWebTool extends ZodToolComponent<typeof SearchWebArgumentsSchema> {
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
  private readonly webSearchAgent: {
    search(input: {
      question: string;
      systemPrompt: string;
      contextMessages: import("../../../llm/types.js").LlmMessage[];
    }): Promise<string>;
  };

  public constructor({
    webSearchAgent,
  }: {
    webSearchAgent: {
      search(input: {
        question: string;
        systemPrompt: string;
        contextMessages: import("../../../llm/types.js").LlmMessage[];
      }): Promise<string>;
    };
  }) {
    super();
    this.webSearchAgent = webSearchAgent;
  }

  protected async executeTyped(
    input: z.infer<typeof SearchWebArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const systemPrompt = context.systemPrompt?.trim();
    const contextMessages = context.messages;

    if (!systemPrompt || !contextMessages) {
      return JSON.stringify({
        ok: false,
        error: "CONTEXT_UNAVAILABLE",
      });
    }

    return await this.webSearchAgent.search({
      question: input.question,
      systemPrompt,
      contextMessages,
    });
  }
}
