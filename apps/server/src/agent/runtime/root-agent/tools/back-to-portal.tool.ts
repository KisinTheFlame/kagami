import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const BACK_TO_PORTAL_TOOL_NAME = "back_to_portal";

const BackToPortalArgumentsSchema = z.object({});

type BackToPortalToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 退出当前 App，把 currentApp 置回 undefined（即 Portal 桌面）。
 *
 * 跟 back 工具的区别：
 * - back：状态树 pop 一级（QQ 群里 → QQ 列表 → Portal 这种垂直导航）
 * - back_to_portal：清空 currentApp（从 App 维度退出，跟状态树正交）
 *
 * 当前未进入任何 App 时调用会得到 ok: false 错误响应，Kagami 自己读了 fix。
 */
export class BackToPortalTool extends ZodToolComponent<typeof BackToPortalArgumentsSchema> {
  public readonly name = BACK_TO_PORTAL_TOOL_NAME;
  public readonly description = "退出当前 App 返回桌面（Portal）。仅当你目前在某个 App 里时调用。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = BackToPortalArgumentsSchema;

  protected async executeTyped(
    _input: z.infer<typeof BackToPortalArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as BackToPortalToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({ ok: false, error: "SESSION_UNAVAILABLE" });
    }

    const currentApp = rootAgentSession.getCurrentApp();
    if (!currentApp) {
      return JSON.stringify({
        ok: false,
        error: "NOT_IN_APP",
        message: "你当前不在任何 App 里。这个工具是从 App 退回桌面用的。",
      });
    }

    rootAgentSession.clearCurrentApp();
    return JSON.stringify({
      ok: true,
      exitedApp: currentApp,
      message: `已退出 ${currentApp} App，回到桌面。`,
    });
  }
}
