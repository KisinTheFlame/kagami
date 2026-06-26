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
 * 在两个 App 之间直接切换，不必先 back_to_portal 回桌面再 enter。
 *
 * 三个 App 维度的导航元能力（手机 OS 模型）各管一段：
 * - enter：桌面（Portal） → App（仅当前不在任何 App 时）
 * - back_to_portal：App → 桌面（Portal）
 * - switch：App A → App B（仅当前已经在某个 App 里时）
 *
 * 语义等价于「back_to_portal 紧接 enter」但一步到位：先跑源 App.onBlur()，再
 * switch_app 切焦点到目标，再跑目标 App.onFocus()。Effect 顺序与「先退后进」组合
 * 一致，currentApp 只在 switch_app 被 Interpreter 应用时改变；屏幕只往消息尾部
 * append，不动稳定前缀，KV 缓存友好。
 */
export class SwitchTool extends ZodToolComponent<typeof SwitchArgumentsSchema> {
  public readonly name = SWITCH_TOOL_NAME;
  public readonly description =
    "在 App 之间直接切换：从当前 App 切到另一个 App，不必先 back_to_portal 回桌面。仅当你目前在某个 App 里时调用；在桌面进 App 用 enter。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: '要切换到的目标 App 的 id，例如 "qq"、"calc"、"terminal"、"ithome"、"hn"。',
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

    // switch 只负责 App→App。当前在桌面（无 currentApp）时让 Kagami 改用 enter。
    const currentApp = rootAgentSession.getCurrentApp();
    if (!currentApp) {
      return JSON.stringify({
        ok: false,
        error: "NOT_IN_APP",
        message: "你当前在桌面，没有可切换的源 App。进入某个 App 请用 enter。",
      });
    }

    const targetApp = this.appManager.getApp(input.id);
    if (!targetApp) {
      return JSON.stringify({
        ok: false,
        error: "SWITCH_TARGET_NOT_AVAILABLE",
        id: input.id,
        message: "没有这个 App。先 back_to_portal 回桌面，看 Portal 列出的 App 列表拿正确的 id。",
      });
    }

    // 切到自己是空操作，拒绝以免重复渲染同一屏幕、白白往尾部追加消息浪费 token。
    if (targetApp.id === currentApp) {
      return JSON.stringify({
        ok: false,
        error: "ALREADY_IN_TARGET_APP",
        message: `你已经在 App "${currentApp}" 里了，不需要切换。`,
      });
    }

    // 一步到位的 App→App 切换，Effect 顺序对齐「back_to_portal 紧接 enter」：
    // 1. 源 App.onBlur()（此时 currentApp 仍是源，离开旧屏）
    // 2. switch_app 把焦点切到目标
    // 3. 目标 App.onFocus()（通常 append_message 把目标"屏幕"追加到尾部）
    const sourceApp = this.appManager.getApp(currentApp);
    const onBlurEffects = (await sourceApp?.onBlur?.()) ?? [];
    const onFocusEffects = (await targetApp.onFocus?.()) ?? [];
    const effects: RootAgentEffect[] = [
      ...(onBlurEffects as readonly RootAgentEffect[]),
      { type: "switch_app", appId: targetApp.id },
      ...(onFocusEffects as readonly RootAgentEffect[]),
    ];
    return {
      content: JSON.stringify({
        ok: true,
        fromApp: currentApp,
        toApp: targetApp.id,
        message: `已从 ${currentApp} 切换到 ${targetApp.id} App。调用 help 查看可用工具。`,
      }),
      effects,
    };
  }
}
