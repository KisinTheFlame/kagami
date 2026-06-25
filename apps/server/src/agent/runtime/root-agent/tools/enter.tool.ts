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

export const ENTER_TOOL_NAME = "enter";

const EnterArgumentsSchema = z.object({
  id: z.string().trim().min(1),
});

type EnterToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 进入一个已注册的 App（手机 OS 模型下聊天状态树已退役，enter 只用于进 App）。
 */
export class EnterTool extends ZodToolComponent<typeof EnterArgumentsSchema> {
  public readonly name = ENTER_TOOL_NAME;
  public readonly description = "进入一个已注册的 App（桌面上的能力单元）。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: '目标 App 的 id，例如 "qq"、"calc"、"terminal"、"ithome"、"hn"。',
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = EnterArgumentsSchema;

  private readonly appManager: AppManager;

  public constructor({ appManager }: { appManager: AppManager }) {
    super();
    this.appManager = appManager;
  }

  protected async executeTyped(
    input: z.infer<typeof EnterArgumentsSchema>,
    context: ToolContext,
  ): Promise<string | ToolExecutionResult> {
    const rootAgentSession = (context as EnterToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({ ok: false, error: "SESSION_UNAVAILABLE" });
    }

    const targetApp = this.appManager.getApp(input.id);
    if (!targetApp) {
      return JSON.stringify({
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
        id: input.id,
        message: "没有这个 App。看桌面（Portal）列出的 App 列表拿正确的 id。",
      });
    }

    // 已经在某个 App 里时不允许再 enter 另一个 App。
    const currentApp = rootAgentSession.getCurrentApp();
    if (currentApp) {
      return JSON.stringify({
        ok: false,
        error: "ALREADY_IN_APP",
        message: `你已经在 App "${currentApp}" 里。先 back_to_portal 退出，再进入 "${targetApp.id}"。`,
      });
    }

    // 进 App 的副作用走 Effect 模型：switch_app 切焦点，再展开 onFocus 的 Effect
    // （通常是 append_message 把"屏幕"内容追加到上下文）。顺序：switch_app 在前。
    const onFocusEffects = (await targetApp.onFocus?.()) ?? [];
    const effects: RootAgentEffect[] = [
      { type: "switch_app", appId: targetApp.id },
      ...(onFocusEffects as readonly RootAgentEffect[]),
    ];
    return {
      content: JSON.stringify({
        ok: true,
        type: "app",
        enteredApp: targetApp.id,
        message: `已进入 ${targetApp.id} App。调用 help 查看可用工具。`,
      }),
      effects,
    };
  }
}
