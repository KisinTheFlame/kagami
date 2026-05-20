import type {
  AppManager,
  InvokeSubtoolOwner,
  SubtoolGuardResult,
  ToolContext,
  ToolDefinition,
} from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";
import { renderInvokeToolGuide } from "./invoke-tool-docs.js";

type StateTreeOwnerToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 状态树时代的 invoke 子工具的所有者。
 *
 * 拥有的工具范围："不被 AppManager 拥有的所有 invoke 子工具" —— 也就是 send_message /
 * open_ithome_article / bash / read_bash_output 这些通过状态树节点暴露的旧工具。
 * 用 "catch-all" 的方式定义比硬编码工具名集合更鲁棒（加新状态树工具不用同步改这里）。
 *
 * 是否能调由 RootAgentSession.getAvailableInvokeTools() 决定：当前焦点状态允许列表
 * 里有就 ok，否则返回带 rich docs 的 NOT_AVAILABLE 错误（保留 Kagami 看可替代选项
 * 的体验）。
 */
export function createStateTreeSubtoolOwner(deps: {
  appManager: AppManager;
  invokeToolDefinitionByName: ReadonlyMap<string, ToolDefinition>;
}): InvokeSubtoolOwner {
  return {
    ownsTool: (toolName: string): boolean => !deps.appManager.ownsTool(toolName),
    canInvokeNow: (toolName: string, ctx: ToolContext): SubtoolGuardResult => {
      const session = (ctx as StateTreeOwnerToolContext).rootAgentSession;
      if (!session) {
        return {
          ok: false,
          error: "SESSION_UNAVAILABLE",
          message: "当前会话不可用，暂时无法调用 invoke 子工具。",
        };
      }
      const availableTools = session.getAvailableInvokeTools();
      const isAllowed = (availableTools as readonly string[]).includes(toolName);
      if (isAllowed) {
        return { ok: true };
      }

      const focusedStateId = session.getState().focusedStateId;
      const availableToolDefinitions = availableTools
        .map(name => deps.invokeToolDefinitionByName.get(name))
        .filter((definition): definition is ToolDefinition => definition !== undefined);
      const availableMessage =
        availableToolDefinitions.length === 0
          ? "当前状态没有可用的 invoke 子工具。"
          : `当前状态可用的 invoke 工具说明：\n${renderInvokeToolGuide(availableToolDefinitions)}`;

      return {
        ok: false,
        error: "INVOKE_TOOL_NOT_AVAILABLE",
        message: `invoke 子工具 ${toolName} 不能在当前状态 ${focusedStateId} 下调用。\n${availableMessage}`,
        extras: {
          state: focusedStateId,
          availableTools,
        },
      };
    },
  };
}
