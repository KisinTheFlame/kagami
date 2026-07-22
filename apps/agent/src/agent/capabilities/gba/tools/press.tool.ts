import { z } from "zod";
import type { ToolExecutionResult, ToolKind } from "@kagami/agent-runtime";
import { GbaButtonSchema } from "@kagami/gba-api/contract";
import { GbaToolComponent } from "./gba-tool-component.js";
import { buildGbaScreenToolResult } from "../render/gba-screen-effect.js";
import { withForegroundRealign } from "./foreground-realign.js";
import type { GbaClient } from "../../../../acl/gba-client.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const GBA_PRESS_TOOL_NAME = "press";

const GBA_BUTTON_VALUES = GbaButtonSchema.options;

const Schema = z.object({
  buttons: z.array(GbaButtonSchema).min(1),
  hold_frames: z.number().int().min(1).max(120).default(3),
  settle_frames: z.number().int().min(0).max(120).default(12),
});

type Deps = {
  getGbaClient: () => GbaClient;
  ossClient?: OssClient;
};

export class GbaPressTool extends GbaToolComponent<typeof Schema> {
  public readonly name = GBA_PRESS_TOOL_NAME;
  public readonly description =
    "按一次键（可多键同按，如 b+right 跑步），执行完自动把当前画面截图进你的视野。游戏在前台以真机速度实时运行：hold_frames 是按住的帧数（60帧≈1秒；点按用默认 3，长按走路/加速给 30-120），settle_frames 是松开后等画面结算的帧数（默认 12；对话滚动等慢动画给 30-90）。";
  public readonly parameters = {
    type: "object",
    properties: {
      buttons: {
        type: "array",
        items: { type: "string", enum: GBA_BUTTON_VALUES },
        description: "同时按下的键（最多 4 个；up+down / left+right 互斥）。",
      },
      hold_frames: {
        type: "integer",
        description: "按住多少帧（1-120，默认 3≈50ms；长按方向键走路给 30-120）。",
      },
      settle_frames: {
        type: "integer",
        description: "松开后等画面结算多少帧再截图（0-120，默认 12≈200ms）。",
      },
    },
    required: ["buttons"],
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
    const imageBase64 = await withForegroundRealign(client, () =>
      client.press({
        buttons: input.buttons,
        holdFrames: input.hold_frames,
        settleFrames: input.settle_frames,
      }),
    );
    return buildGbaScreenToolResult({ imageBase64, ossClient: this.ossClient });
  }
}
