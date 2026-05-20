import type { ToolContext } from "../tool/tool-component.js";
import type { InvokeSubtoolOwner, SubtoolGuardResult } from "../tool/subtool-owner.js";
import type { AppId, AppManager } from "./app.js";

/**
 * 把 AppManager + "如何拿到当前 App" 这个回调，包装成 InvokeSubtoolOwner。
 *
 * 这是 App 框架在 invoke 调度链上的适配层：
 * - ownsTool 直接代理到 appManager.ownsTool
 * - canInvokeNow 通过回调拿到 currentApp，再问 appManager.canInvoke
 *
 * getCurrentApp 通常由 host 拿 ctx 里挂的 session 来取（参考 helpTool 的写法），
 * 但具体怎么取由 host 决定。agent-runtime 自己不关心 session 是什么样。
 */
export function createAppSubtoolOwner(deps: {
  appManager: AppManager;
  getCurrentApp: (ctx: ToolContext) => AppId | undefined;
}): InvokeSubtoolOwner {
  return {
    ownsTool: (toolName: string): boolean => deps.appManager.ownsTool(toolName),
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
  };
}
