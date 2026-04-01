import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const BACK_TOOL_NAME = "back";
export const BACK_TO_PORTAL_TOOL_NAME = BACK_TOOL_NAME;

const BackArgumentsSchema = z.object({});

type BackToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class BackTool extends ZodToolComponent<typeof BackArgumentsSchema> {
  public readonly name = BACK_TOOL_NAME;
  public readonly description = "退出当前焦点状态并返回上一级状态。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = BackArgumentsSchema;

  protected async executeTyped(
    _input: z.infer<typeof BackArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as BackToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({
        ok: false,
        error: "SESSION_UNAVAILABLE",
      });
    }

    return JSON.stringify(await rootAgentSession.back());
  }
}

export { BackTool as BackToPortalTool };
