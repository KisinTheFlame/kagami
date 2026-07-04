import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderShowResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

export const PIXEL_SHOW_CANVAS_TOOL_NAME = "show_canvas";

const Schema = z.object({});

export class PixelShowCanvasTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_SHOW_CANVAS_TOOL_NAME;
  public readonly description =
    "查看当前画布的完整网格（带坐标标尺 + 图例）。绘图工具平时只回摘要，想看全貌用它。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getPixelClient: () => PixelClient;

  public constructor({ getPixelClient }: { getPixelClient: () => PixelClient }) {
    super();
    this.getPixelClient = getPixelClient;
  }

  protected async executeTyped(): Promise<string> {
    return renderShowResponse(await this.getPixelClient().getCanvas());
  }
}
