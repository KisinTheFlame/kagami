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
import type { RootAgentSessionController } from "../session/root-agent-session.js";
import { renderInvokeToolGuide } from "./invoke-tool-docs.js";

type StateTreeOwnerToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 状态树时代的 invoke 子工具的所有者：send_message / open_ithome_article /
 * bash / read_bash_output 这些通过状态树节点（QQ 群、IT 之家、Terminal）暴露的
 * 工具。
 *
 * Ownership 现在是**显式的**——传进来的 tools 列表就是这个 owner 全部声明拥有
 * 的工具，不再用"!appManager.ownsTool" 这种 catch-all。InvokeTool 在构造期会
 * 校验同名冲突，多 owner 同时声明会直接抛错，比运行期 find 短路更可靠。
 *
 * 是否能调由 RootAgentSession.getAvailableInvokeTools() 决定。session 知识完全
 * 内化在本 owner，InvokeTool 顶层不再 hard-require session。
 */
export function createStateTreeSubtoolOwner(deps: {
  tools: readonly ToolComponent[];
}): InvokeSubtoolOwner {
  const toolNames = deps.tools.map(tool => tool.name);
  const definitions: readonly Tool[] = deps.tools.map(tool => tool.llmTool);
  const definitionByName = new Map<string, Tool>(deps.tools.map(tool => [tool.name, tool.llmTool]));
  const executor: ToolExecutor = new ToolCatalog([...deps.tools]).pick(toolNames);

  return {
    listOwnedTools: () => definitions,
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
        .map(name => definitionByName.get(name))
        .filter((definition): definition is Tool => definition !== undefined);
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
    execute: async (
      toolName: string,
      args: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolExecutionResult> => {
      return await executor.execute(toolName, args, ctx);
    },
  };
}
