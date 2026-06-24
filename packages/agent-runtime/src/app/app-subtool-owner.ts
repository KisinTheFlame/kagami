import { ToolCatalog, type ToolExecutor } from "../tool/tool-catalog.js";
import type { ToolContext, Tool, ToolExecutionResult } from "../tool/tool-component.js";
import type { InvokeSubtoolOwner, SubtoolGuardResult } from "../tool/subtool-owner.js";
import type { AppId, AppManager } from "./app.js";

/**
 * 把 AppManager + "如何拿到当前 App" 这个回调，包装成 InvokeSubtoolOwner。
 *
 * Owner 在构造期把已注册 App 的所有子工具摊平进自己的内部 executor，
 * 之后的执行 / docs / gate 都不再绕回 AppManager 取 ToolComponent。
 *
 * getCurrentApp 通常由 host 拿 ctx 里挂的 session 来取，但具体怎么取由 host
 * 决定。agent-runtime 自己不关心 session 是什么样。
 *
 * 注意：因为构造期 snapshot 了 App tools，调用方必须先 register 完所有 App
 * 再 createAppSubtoolOwner——这与 InvokeTool 在 startup 时一次性确定 LLM 工具
 * 定义的"稳定前缀"原则一致。
 */
export function createAppSubtoolOwner(deps: {
  appManager: AppManager;
  getCurrentApp: (ctx: ToolContext) => AppId | undefined;
}): InvokeSubtoolOwner {
  const appTools = deps.appManager.getAllApps().flatMap(app => [...app.tools]);
  const toolNames = appTools.map(tool => tool.name);
  const definitions: readonly Tool[] = appTools.map(tool => tool.llmTool);
  const executor: ToolExecutor = new ToolCatalog(appTools).pick(toolNames);

  return {
    listOwnedTools: () => definitions,
    canInvokeNow: (toolName: string, ctx: ToolContext): SubtoolGuardResult => {
      const currentApp = deps.getCurrentApp(ctx);
      const result = deps.appManager.canInvoke(toolName, currentApp);
      if (result.ok) {
        return { ok: true };
      }
      return {
        ok: false,
        error: "INVOKE_TOOL_APP_GUARD",
        message: result.reason,
      };
    },
    execute: async (
      toolName: string,
      args: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolExecutionResult> => {
      return await executor.execute(toolName, args, ctx);
    },
  };
}
