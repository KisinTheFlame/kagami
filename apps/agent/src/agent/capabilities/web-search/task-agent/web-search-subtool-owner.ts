import {
  ToolCatalog,
  type InvokeSubtoolOwner,
  type SubtoolGuardResult,
  type ToolComponent,
  type ToolContext,
  type Tool,
  type ToolExecutionResult,
  type ToolExecutor,
} from "@kagami/agent-runtime";

/**
 * 网页搜索 task agent 的 invoke 子工具所有者。
 *
 * 只挂在 WebSearchTaskAgent 自己的 InvokeTool 实例上，主 Agent 视野完全看不到
 * 这些工具——因此 canInvokeNow 永远 ok，不需要任何 scope 标记或 session 检查。
 * 这是 owner-driven dispatch 的关键回报：装配阶段就已经决定了"谁能调"，运行
 * 期不再需要业务字段穿透 ToolContext。
 */
export function createWebSearchSubtoolOwner(deps: {
  tools: readonly ToolComponent[];
}): InvokeSubtoolOwner {
  const toolNames = deps.tools.map(tool => tool.name);
  const definitions: readonly Tool[] = deps.tools.map(tool => tool.llmTool);
  const executor: ToolExecutor = new ToolCatalog([...deps.tools]).pick(toolNames);

  return {
    listOwnedTools: () => definitions,
    canInvokeNow: (_toolName: string, _ctx: ToolContext): SubtoolGuardResult => ({ ok: true }),
    execute: async (
      toolName: string,
      args: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolExecutionResult> => {
      return await executor.execute(toolName, args, ctx);
    },
  };
}
