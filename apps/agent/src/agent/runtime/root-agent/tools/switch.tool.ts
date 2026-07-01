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

export const SWITCH_TOOL_NAME = "switch";

const SwitchArgumentsSchema = z.object({
  id: z.string().trim().min(1),
});

type SwitchToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 唯一的 App 导航工具（手机 OS 模型）。目标永远是一个已注册的 App。
 *
 * Portal（桌面）只是初始状态、离开后不可返回，因此 switch 不需要"回桌面"目标：
 * - 从 Portal（currentApp 为空）调用：进入目标 App（跳过 onBlur，只跑目标 onFocus）。
 * - 从某个 App 调用：先跑源 App.onBlur()，再 switch_app 切焦点，再跑目标 App.onFocus()。
 *
 * currentApp 只在 switch_app 被 Interpreter 应用时改变；屏幕只往消息尾部 append，
 * 不动稳定前缀，KV 缓存友好。
 */
export class SwitchTool extends ZodToolComponent<typeof SwitchArgumentsSchema> {
  public readonly name = SWITCH_TOOL_NAME;
  public readonly description =
    "进入或切换到一个 App。在桌面时进入该 App；已经在别的 App 里时直接切过去。想知道有哪些 App 用 list_apps。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          '要进入 / 切换到的目标 App 的 id，例如 "qq"、"calc"、"terminal"、"ithome"、"hn"。',
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SwitchArgumentsSchema;

  private readonly appManager: AppManager;

  public constructor({ appManager }: { appManager: AppManager }) {
    super();
    this.appManager = appManager;
  }

  protected async executeTyped(
    input: z.infer<typeof SwitchArgumentsSchema>,
    context: ToolContext,
  ): Promise<string | ToolExecutionResult> {
    const rootAgentSession = (context as SwitchToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({ ok: false, error: "SESSION_UNAVAILABLE" });
    }

    const targetApp = this.appManager.getApp(input.id);
    if (!targetApp) {
      return JSON.stringify({
        ok: false,
        error: "SWITCH_TARGET_NOT_AVAILABLE",
        id: input.id,
        message: "没有这个 App。用 list_apps 查看有哪些 App、拿正确的 id。",
      });
    }

    // 当前所在 App；为空表示还在 Portal（初始状态）。
    const currentApp = rootAgentSession.getCurrentApp();

    // 切到自己是空操作，拒绝以免重复渲染同一屏幕、白白往尾部追加消息浪费 token。
    if (targetApp.id === currentApp) {
      return JSON.stringify({
        ok: false,
        error: "ALREADY_IN_TARGET_APP",
        message: `你已经在 App "${currentApp}" 里了，不需要切换。`,
      });
    }

    // Effect 顺序：
    // 1. 源 App.onBlur()（仅当前已在某个 App 里；在 Portal 时没有源，跳过）
    // 2. switch_app 把焦点切到目标
    // 3. 目标 App.onFocus()（通常 append_message 把目标"屏幕"追加到尾部）
    const sourceApp = currentApp ? this.appManager.getApp(currentApp) : undefined;
    const onBlurEffects = (await sourceApp?.onBlur?.()) ?? [];
    const onFocusEffects = (await targetApp.onFocus?.()) ?? [];
    const effects: RootAgentEffect[] = [
      ...(onBlurEffects as readonly RootAgentEffect[]),
      { type: "switch_app", appId: targetApp.id },
      ...(onFocusEffects as readonly RootAgentEffect[]),
    ];
    const message = currentApp
      ? `已从 ${currentApp} 切换到 ${targetApp.id} App。调用 help 查看可用工具。`
      : `已进入 ${targetApp.id} App。调用 help 查看可用工具。`;
    return {
      content: JSON.stringify({
        ok: true,
        fromApp: currentApp ?? null,
        toApp: targetApp.id,
        message,
      }),
      effects,
    };
  }
}
