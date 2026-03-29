import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import {
  ROOT_AGENT_ENTER_TARGET_KINDS,
  type RootAgentSessionController,
} from "../session/root-agent-session.js";

export const ENTER_TOOL_NAME = "enter";

const EnterArgumentsSchema = z
  .object({
    kind: z.enum(ROOT_AGENT_ENTER_TARGET_KINDS),
    id: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "qq_group" && !value.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "进入 qq_group 时必须提供 id",
      });
    }

    if (value.kind === "zone_out" && value.id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "进入 zone_out 时不需要提供 id",
      });
    }
  });

type EnterToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class EnterTool extends ZodToolComponent<typeof EnterArgumentsSchema> {
  public readonly name = ENTER_TOOL_NAME;
  public readonly description = "从门户状态进入一个可进入目标，例如某个 QQ 群或神游状态。";
  public readonly parameters = {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: '进入目标类型。当前支持 "qq_group" 和 "zone_out"。',
      },
      id: {
        type: "string",
        description: '目标 ID。kind 为 "qq_group" 时填写群 ID；kind 为 "zone_out" 时不要填写。',
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = EnterArgumentsSchema;

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

    return JSON.stringify(
      await rootAgentSession.enter({
        kind: input.kind,
        ...(input.id !== undefined ? { id: input.id } : {}),
      }),
    );
  }
}
