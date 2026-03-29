import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const BACK_TO_PORTAL_TOOL_NAME = "back_to_portal";

const BackToPortalArgumentsSchema = z.object({});

type BackToPortalToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class BackToPortalTool extends ZodToolComponent<typeof BackToPortalArgumentsSchema> {
  public readonly name = BACK_TO_PORTAL_TOOL_NAME;
  public readonly description = "退出当前群聊并返回门户状态。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = BackToPortalArgumentsSchema;

  protected async executeTyped(
    _input: z.infer<typeof BackToPortalArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as BackToPortalToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({
        ok: false,
        error: "SESSION_UNAVAILABLE",
      });
    }

    return JSON.stringify(await rootAgentSession.backToPortal());
  }
}
