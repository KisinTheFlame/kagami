import { ToolCatalog, type ToolExecutor } from "./tool-catalog.js";
import type { InvokeSubtoolOwner, SubtoolGuardResult } from "./subtool-owner.js";
import type { ToolComponent, ToolContext, Tool, ToolExecutionResult } from "./tool-component.js";

/**
 * 无门禁的 invoke 子工具 owner：canInvokeNow 永远 ok。
 *
 * 给 task agent 专属的 InvokeTool 实例用——这些子工具只挂在 task agent 自己的
 * invoke 上，主 Agent 视野完全看不到，"谁能调"在装配阶段就已经决定，运行期
 * 不需要任何 scope 标记或 session 检查。这是 owner-driven dispatch 的关键回报。
 */
export function createUnguardedSubtoolOwner(deps: {
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
