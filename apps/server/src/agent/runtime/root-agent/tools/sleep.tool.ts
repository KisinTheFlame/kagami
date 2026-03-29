import { z } from "zod";
import {
  ZodToolComponent,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const SLEEP_TOOL_NAME = "sleep";

const SleepArgumentsSchema = z.object({});

type SleepToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class SleepTool extends ZodToolComponent<typeof SleepArgumentsSchema> {
  public readonly name = SLEEP_TOOL_NAME;
  public readonly description =
    "在门户状态进入睡眠。睡眠时长由系统配置决定，睡眠期间不会被新消息提前唤醒。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "control";
  protected readonly inputSchema = SleepArgumentsSchema;
  private readonly sleepMs: number;

  public constructor({ sleepMs }: { sleepMs: number }) {
    super();
    this.sleepMs = sleepMs;
  }

  protected async executeTyped(
    _input: z.infer<typeof SleepArgumentsSchema>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const rootAgentSession = (context as SleepToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return {
        content: JSON.stringify({
          ok: false,
          error: "SESSION_UNAVAILABLE",
        }),
        signal: "continue",
      };
    }

    if (rootAgentSession.getState().kind !== "portal") {
      return {
        content: JSON.stringify({
          ok: false,
          error: "STATE_TRANSITION_NOT_ALLOWED",
        }),
        signal: "continue",
      };
    }

    return {
      content: "",
      signal: "sleep",
      sleepMs: this.sleepMs,
    };
  }
}
