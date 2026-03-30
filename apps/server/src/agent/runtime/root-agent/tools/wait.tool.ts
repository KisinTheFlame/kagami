import { z } from "zod";
import {
  ZodToolComponent,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const WAIT_TOOL_NAME = "wait";
const MAX_WAIT_MS = 10 * 60 * 1000;

const WaitArgumentsSchema = z.object({});

type WaitToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class WaitTool extends ZodToolComponent<typeof WaitArgumentsSchema> {
  public readonly name = WAIT_TOOL_NAME;
  public readonly description =
    "在门户状态进入最多 10 分钟的等待，直到新的 QQ 消息出现或等待自然结束。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = WaitArgumentsSchema;
  private readonly now: () => Date;

  public constructor({ now }: { now?: () => Date } = {}) {
    super();
    this.now = now ?? (() => new Date());
  }

  protected async executeTyped(
    _input: z.infer<typeof WaitArgumentsSchema>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const rootAgentSession = (context as WaitToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return {
        content: JSON.stringify({
          ok: false,
          error: "SESSION_UNAVAILABLE",
        }),
        signal: "continue",
      };
    }

    const result = await rootAgentSession.wait({
      deadlineAt: new Date(this.now().getTime() + MAX_WAIT_MS),
    });

    if (result.ok === false) {
      return {
        content: JSON.stringify(result),
        signal: "continue",
      };
    }

    return {
      content: JSON.stringify(result),
      signal: "finish_round",
    };
  }
}
