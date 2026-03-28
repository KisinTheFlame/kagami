import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const ENTER_GROUP_TOOL_NAME = "enter_group";

const EnterGroupArgumentsSchema = z.object({
  groupId: z.string().trim().min(1),
});

type EnterGroupToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class EnterGroupTool extends ZodToolComponent<typeof EnterGroupArgumentsSchema> {
  public readonly name = ENTER_GROUP_TOOL_NAME;
  public readonly description = "从门户状态进入某个群聊。";
  public readonly parameters = {
    type: "object",
    properties: {
      groupId: {
        type: "string",
        description: "要进入的群 ID。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = EnterGroupArgumentsSchema;

  protected async executeTyped(
    input: z.infer<typeof EnterGroupArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as EnterGroupToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({
        ok: false,
        error: "SESSION_UNAVAILABLE",
      });
    }

    return JSON.stringify(
      await rootAgentSession.enterGroup({
        groupId: input.groupId,
      }),
    );
  }
}
