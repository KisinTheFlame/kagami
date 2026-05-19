import { z } from "zod";
import {
  ZodToolComponent,
  type AppManager,
  type ToolContext,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const ENTER_TOOL_NAME = "enter";

const EnterArgumentsSchema = z.union([
  z.object({
    kind: z.enum(["qq_group", "qq_private", "ithome", "zone_out", "terminal"]),
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
          '目标的唯一 ID。可以是状态树节点，例如 "qq_group:123456"、"qq_private:123456"、"ithome"、"zone_out" 或 "terminal"；也可以是已注册的 App id，例如 "calc"。',
      },
      kind: {
        type: "string",
        description:
          '状态节点的 kind 提示，可选值 "qq_group"、"qq_private"、"ithome"、"zone_out"、"terminal"。仅状态树用，App 不需要传 kind，只传 id 即可。',
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
  ): Promise<string> {
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
        rootAgentSession.setCurrentApp(targetApp.id);
        return JSON.stringify({
          ok: true,
          type: "app",
          enteredApp: targetApp.id,
          message: `已进入 ${targetApp.id} App。调用 help 查看可用工具。`,
        });
      }
    }

    return JSON.stringify(await rootAgentSession.enter("kind" in input ? input : { id: input.id }));
  }
}
