import { z } from "zod";
import type { ToolExecutionResult, ToolKind } from "@kagami/agent-runtime";
import { GbaButtonSchema } from "@kagami/gba-api/contract";
import { GbaToolComponent } from "./gba-tool-component.js";
import { buildGbaScreenToolResult } from "../render/gba-screen-effect.js";
import { withForegroundRealign } from "./foreground-realign.js";
import type { GbaClient } from "../../../../acl/gba-client.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const GBA_PRESS_SEQUENCE_TOOL_NAME = "press_sequence";

const GBA_BUTTON_VALUES = GbaButtonSchema.options;

const StepSchema = z.object({
  buttons: z.array(GbaButtonSchema).min(1),
  hold_frames: z.number().int().min(1).max(120).default(3),
  gap_frames: z.number().int().min(1).max(30).default(3),
});

const Schema = z.object({
  steps: z.array(StepSchema).min(1).max(8),
  settle_frames: z.number().int().min(0).max(120).default(12),
});

type Deps = {
  getGbaClient: () => GbaClient;
  ossClient?: OssClient;
};

export class GbaPressSequenceTool extends GbaToolComponent<typeof Schema> {
  public readonly name = GBA_PRESS_SEQUENCE_TOOL_NAME;
  public readonly description =
    "连按一串键（如菜单导航「下、下、A」），一次调用省多轮往返，结束后自动截图进你的视野。只用于**同一个稳定菜单里的机械连按**——遇到确认框、切地图、进战斗这类画面语义会变的边界，必须拆开分次按，别盲按。最多 8 步、总帧数（含间隔与结算）≤300。";
  public readonly parameters = {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            buttons: {
              type: "array",
              items: { type: "string", enum: GBA_BUTTON_VALUES },
              description: "本步同时按下的键（最多 4 个）。",
            },
            hold_frames: { type: "integer", description: "按住帧数（1-120，默认 3）。" },
            gap_frames: { type: "integer", description: "本步松开后的间隔帧数（1-30，默认 3）。" },
          },
          required: ["buttons"],
        },
        description: "按键序列，按顺序执行（最多 8 步）。",
      },
      settle_frames: {
        type: "integer",
        description: "最后一步松开后等画面结算多少帧再截图（0-120，默认 12）。",
      },
    },
    required: ["steps"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getGbaClient: () => GbaClient;
  private readonly ossClient: OssClient | undefined;

  public constructor({ getGbaClient, ossClient }: Deps) {
    super();
    this.getGbaClient = getGbaClient;
    this.ossClient = ossClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const client = this.getGbaClient();
    const outcome = await withForegroundRealign(client, () =>
      client.pressSequence({
        steps: input.steps.map(step => ({
          buttons: step.buttons,
          holdFrames: step.hold_frames,
          gapFrames: step.gap_frames,
        })),
        settleFrames: input.settle_frames,
      }),
    );
    return buildGbaScreenToolResult({
      imageBase64: outcome.imageBase64,
      ossClient: this.ossClient,
    });
  }
}
