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

/** 自动吐出的 App 能力说明所用的结构标识伪标签（结构标识非语气文案，留 TS 常量）。 */
const APP_HELP_TAG = "app_help";

/**
 * 把一段 help 文本包进 `<app_help app="...">` 结构标签。app id 取自注册常量（可信），但
 * help 正文**不完全可信**——部分 App 的 help 内嵌外部内容（如 browser help 带网页标题/URL），
 * 恶意标题可含伪闭合标签冲破结构边界。故中和正文里的字面闭合标签，保住 `<app_help>` 的结构完整。
 */
function renderAppHelp(appId: string, help: string): string {
  const safeHelp = help.replaceAll(`</${APP_HELP_TAG}>`, `<\\/${APP_HELP_TAG}>`);
  return `<${APP_HELP_TAG} app="${appId}">\n${safeHelp}\n</${APP_HELP_TAG}>`;
}

/** switch 成功后的状态提示。首进且已自带 help 时不再提示手动 help；否则保留提示。 */
function buildSwitchMessage(fromApp: string | null, toApp: string, helpEmitted: boolean): string {
  const base = fromApp ? `已从 ${fromApp} 切换到 ${toApp} App。` : `已进入 ${toApp} App。`;
  return helpEmitted ? `${base}下面是它的能力说明。` : `${base}调用 help 查看可用工具。`;
}

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
    "进入或切换到一个 App。在桌面时进入该 App；已经在别的 App 里时直接切过去。有哪些 App 见系统说明里的 App 列表。";
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
        message: "没有这个 App。可用的 App 见系统说明里的 App 列表，照那里的 id 来。",
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

    // 首次进入（本桶上下文）自动把 App 的 help 追加到尾部，省掉小镜再花一整轮去调 help 工具。
    // help 只读 hasEnteredApp 决策；真正的 markAppEntered 由 switch_app effect 在解释期落，保持
    // 工具无副作用（与既有 setCurrentApp 同语义）。部分 App 的 help 有 I/O（如 browser 走 GET
    // /location）、且正文可能内嵌外部内容，故：help 抛错绝不连累 switch——降级为不追加 app_help、
    // 退回「自己调 help」提示；正文里的伪闭合标签由 renderAppHelp 中和。首进标记照常（即便本次
    // help 失败），避免下一轮又试又失败刷屏；失败模式良性——小镜可手动调 help 兜底。
    let helpEmitted = false;
    if (!rootAgentSession.hasEnteredApp(targetApp.id)) {
      try {
        const help = await targetApp.help();
        effects.push({ type: "append_message", content: renderAppHelp(targetApp.id, help) });
        helpEmitted = true;
      } catch {
        // help 生成失败：保持切换成功，仅退回手动 help 提示。
      }
    }

    const fromApp = currentApp ?? null;
    return {
      content: JSON.stringify({
        ok: true,
        fromApp,
        toApp: targetApp.id,
        message: buildSwitchMessage(fromApp, targetApp.id, helpEmitted),
      }),
      effects,
    };
  }
}
