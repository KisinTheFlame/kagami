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

const EnterArgumentsSchema = z.union([
  z.object({
    kind: z.enum(["qq_group", "qq_private"]),
    id: z.string().trim().min(1).optional(),
  }),
  z.object({
    id: z.string().trim().min(1),
  }),
]);

type EnterToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class EnterTool extends ZodToolComponent<typeof EnterArgumentsSchema> {
  public readonly name = ENTER_TOOL_NAME;
  public readonly description = "进入当前焦点状态下的一个直接子节点，或进入一个已注册的 App。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          '目标的唯一 ID。可以是状态树节点，例如 "qq_group:123456"、"qq_private:123456"；也可以是已注册的 App id，例如 "calc"、"terminal"、"ithome"。',
      },
      kind: {
        type: "string",
        description:
          '状态节点的 kind 提示，可选值 "qq_group"、"qq_private"。仅状态树用，App 不需要传 kind，只传 id 即可。',
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
      return JSON.stringify({
        ok: false,
        error: "SESSION_UNAVAILABLE",
      });
    }

    // 只有 "传 id 不传 kind" 路径才可能是 App（kind 是状态树专用）
    if (!("kind" in input)) {
      const targetApp = this.appManager.getApp(input.id);
      if (targetApp) {
        // Phase 2 约束：进 App 必须在 Portal 状态，避免双维度叠加产生歧义体验
        const focusedStateId = rootAgentSession.getFocusedStateId();
        if (focusedStateId !== "portal") {
          return JSON.stringify({
            ok: false,
            error: "MUST_BE_AT_PORTAL",
            message: `必须先 back 回 Portal 才能进入 App "${targetApp.id}"。当前在状态 "${focusedStateId}"。`,
          });
        }
        // 已经在某个 App 里时不允许再 enter 另一个 App
        const currentApp = rootAgentSession.getCurrentApp();
        if (currentApp) {
          return JSON.stringify({
            ok: false,
            error: "ALREADY_IN_APP",
            message: `你已经在 App "${currentApp}" 里。先 back_to_portal 退出，再进入 "${targetApp.id}"。`,
          });
        }
        // 进 App 的副作用走 Effect 模型，通过 ToolExecutionResult.effects 透传：
        // 1. switch_app 切焦点
        // 2. 展开 app.onFocus() 拿到的 Effect（通常是 append_message 把"屏幕"
        //    内容追加到上下文）
        // 数组顺序 = apply 顺序：switch_app 必须在 append_message 之前，否则
        //   "屏幕"会出现在切焦点之前。
        // 实际执行由 RootEffectsApplyExtension 在 onAfterToolExecution 阶段
        // 调 Interpreter 完成。
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

    return JSON.stringify(await rootAgentSession.enter("kind" in input ? input : { id: input.id }));
  }
}
