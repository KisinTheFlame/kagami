import { z } from "zod";
import {
  AsyncTool,
  type AsyncTaskManager,
  type AsyncToolPreparation,
  type JsonSchema,
  type TaskAgentInvoker,
  type ToolComponent,
  type ToolContext,
} from "@kagami/agent-runtime";
import type { AgentContext } from "../../../runtime/context/agent-context.js";
import type { RootAgentSessionController } from "../../../runtime/root-agent/session/root-agent-session.js";
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
type SearchWebInput = z.infer<typeof SearchWebArgumentsSchema>;

const SEARCH_WEB_DESCRIPTION =
  "把一个自然语言问题交给网页搜索子 Agent，让它自行拆词、多次检索并返回摘要。这是异步工具：调用后立即返回，结果稍后以 async_tool_result 回来。";

const SEARCH_WEB_PARAMETERS = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "需要查询的自然语言问题。",
    },
  },
} as const satisfies JsonSchema;

type SearchWebToolContext = ToolContext & {
  agentContext?: AgentContext;
  rootAgentSession?: RootAgentSessionController;
};

export type CreateSearchWebToolDeps = {
  webSearchTaskAgent: WebSearchTaskAgentLike;
  asyncTaskManager: AsyncTaskManager;
};

function rejectWith(error: string): AsyncToolPreparation {
  return { kind: "reject", content: JSON.stringify({ ok: false, error }) };
}

/**
 * search_web 的同步准备：门控（session / chatTarget）+ 决定上下文来源，返回 reject|submit。
 *
 * 同步门控不通过时 reject（原样作为 tool_result）。通过时返回 submit，其 run thunk：
 * 优先用提交时刻已 structuredClone 冻结的 inline 快照（与主上下文后续漂移解耦）；
 * 无 inline 时才在后台 await agentContext.getSnapshot() 兜底。run 内才真正跑子 Agent。
 *
 * 近乎纯函数，独立可测。
 */
export function prepareSearchWeb(
  input: SearchWebInput,
  context: ToolContext,
  webSearchTaskAgent: WebSearchTaskAgentLike,
): AsyncToolPreparation {
  const typedContext = context as SearchWebToolContext;
  const agentContext = typedContext.agentContext;
  const rootAgentSession = typedContext.rootAgentSession;

  if (!rootAgentSession) {
    return rejectWith("SESSION_UNAVAILABLE");
  }
  if (!rootAgentSession.getCurrentChatTarget()) {
    return rejectWith("STATE_TRANSITION_NOT_ALLOWED");
  }

  const inlineSystemPrompt = typedContext.systemPrompt?.trim();
  const inlineMessages = typedContext.messages ? structuredClone(typedContext.messages) : null;
  const hasInlineContext = Boolean(inlineSystemPrompt) && inlineMessages !== null;

  // 既无可用 inline 上下文、又无 agentContext 兜底 → 同步拒绝。
  if (!hasInlineContext && !agentContext) {
    return rejectWith("CONTEXT_UNAVAILABLE");
  }

  const run = async (): Promise<string> => {
    const snapshot = hasInlineContext
      ? null
      : agentContext
        ? await agentContext.getSnapshot()
        : null;
    const systemPrompt = inlineSystemPrompt ?? snapshot?.systemPrompt.trim() ?? "";
    const contextMessages = inlineMessages ?? structuredClone(snapshot?.messages ?? []);

    if (!systemPrompt) {
      return JSON.stringify({ ok: false, error: "CONTEXT_UNAVAILABLE" });
    }

    const taskInput: WebSearchTaskInput = {
      question: input.question,
      systemPrompt,
      contextMessages,
    };

    if ("invoke" in webSearchTaskAgent) {
      return await webSearchTaskAgent.invoke(taskInput);
    }
    return await webSearchTaskAgent.search(taskInput);
  };

  return { kind: "submit", run };
}

/**
 * 用 AsyncTool 装配出 search_web 工具实例（组合而非继承）。占位由 AsyncTool 统一产出，
 * 本工厂只提供 name/描述/schema + 注入 prepareSearchWeb 与 asyncTaskManager。
 */
export function createSearchWebTool(deps: CreateSearchWebToolDeps): ToolComponent {
  return new AsyncTool({
    name: SEARCH_WEB_TOOL_NAME,
    description: SEARCH_WEB_DESCRIPTION,
    parameters: SEARCH_WEB_PARAMETERS,
    inputSchema: SearchWebArgumentsSchema,
    asyncTaskManager: deps.asyncTaskManager,
    prepareAsync: (input, context) => prepareSearchWeb(input, context, deps.webSearchTaskAgent),
  });
}
