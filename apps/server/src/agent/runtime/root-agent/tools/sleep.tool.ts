import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";

export const SLEEP_TOOL_NAME = "sleep";

const SleepArgumentsSchema = z.object({});

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

  protected async executeTyped(): Promise<ToolExecutionResult> {
    return {
      content: "",
      signal: "sleep",
      sleepMs: this.sleepMs,
    };
  }
}
