import { z } from "zod";
import {
  ZodToolComponent,
  type AppManager,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { RootAgentEffect } from "../../effect/root-agent-effect.js";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const BACK_TO_PORTAL_TOOL_NAME = "back_to_portal";

const BackToPortalArgumentsSchema = z.object({});

type BackToPortalToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 退出当前 App，把 currentApp 置回 undefined（即 Portal 桌面）。
 *
 * 手机 OS 模型下只有 App 一个维度的进/出：enter 进 App、back_to_portal 退回桌面。
 * App 内部的导航（如 QQ 的会话列表 ↔ 单个会话）由各 App 自己的工具承担，不再有
 * 跨 App 的状态树 / back 一级 pop（聊天状态树已退役）。
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

  private readonly appManager: AppManager;

  public constructor({ appManager }: { appManager: AppManager }) {
    super();
    this.appManager = appManager;
  }

  protected async executeTyped(
    _input: z.infer<typeof BackToPortalArgumentsSchema>,
    context: ToolContext,
  ): Promise<string | ToolExecutionResult> {
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

    // 退出 App 走 Effect 模型：
    // 1. 展开当前 App.onBlur() 拿到的 Effect（通常空数组，可能有"再见"屏幕）
    // 2. switch_app{null} 把 currentApp 置回 undefined
    // 顺序：先 onBlur（在还认 currentApp 的状态下产 Effect），再 switch。
    const targetApp = this.appManager.getApp(currentApp);
    const onBlurEffects = (await targetApp?.onBlur?.()) ?? [];
    const effects: RootAgentEffect[] = [
      ...(onBlurEffects as readonly RootAgentEffect[]),
      { type: "switch_app", appId: null },
    ];
    return {
      content: JSON.stringify({
        ok: true,
        exitedApp: currentApp,
        message: `已退出 ${currentApp} App，回到桌面。`,
      }),
      effects,
    };
  }
}
