import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const ENTER_TOOL_NAME = "enter";

const EnterArgumentsSchema = z.union([
  z.object({
    kind: z.enum(["qq_group", "qq_private", "ithome", "zone_out"]),
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
  public readonly description = "进入当前焦点状态下的一个直接子节点。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          '目标状态的唯一 ID，例如 "qq_group:123456"、"qq_private:123456"、"ithome" 或 "zone_out"。',
      },
      kind: {
        type: "string",
        description:
          '目标状态类型，可选值为 "qq_group"、"qq_private"、"ithome" 或 "zone_out"；传完整状态 ID 时可省略。',
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

    return JSON.stringify(await rootAgentSession.enter("kind" in input ? input : { id: input.id }));
  }
}
