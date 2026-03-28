import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const EXIT_GROUP_TOOL_NAME = "exit_group";

const ExitGroupArgumentsSchema = z.object({});

type ExitGroupToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class ExitGroupTool extends ZodToolComponent<typeof ExitGroupArgumentsSchema> {
  public readonly name = EXIT_GROUP_TOOL_NAME;
  public readonly description = "退出当前群聊并返回门户状态。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ExitGroupArgumentsSchema;

  protected async executeTyped(
    _input: z.infer<typeof ExitGroupArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as ExitGroupToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({
        ok: false,
        error: "SESSION_UNAVAILABLE",
      });
    }

    return JSON.stringify(await rootAgentSession.exitGroup());
  }
}
