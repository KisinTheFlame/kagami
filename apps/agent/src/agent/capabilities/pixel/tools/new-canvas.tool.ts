import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { MAX_CANVAS_SIZE } from "@kagami/pixel-api/contract";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

export const PIXEL_NEW_CANVAS_TOOL_NAME = "new_canvas";

const Schema = z.object({
  width: z.number().int().min(1).max(MAX_CANVAS_SIZE),
  height: z.number().int().min(1).max(MAX_CANVAS_SIZE),
});

export class PixelNewCanvasTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_NEW_CANVAS_TOOL_NAME;
  public readonly description = `新建一块全空画布（会替换当前画布）。width/height 是格子数，1..${MAX_CANVAS_SIZE}。`;
  public readonly parameters = {
    type: "object",
    properties: {
      width: { type: "number", description: `宽（格子数），1..${MAX_CANVAS_SIZE}。` },
      height: { type: "number", description: `高（格子数），1..${MAX_CANVAS_SIZE}。` },
    },
    required: ["width", "height"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getPixelClient: () => PixelClient;

  public constructor({ getPixelClient }: { getPixelClient: () => PixelClient }) {
    super();
    this.getPixelClient = getPixelClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    return renderDrawResponse(await this.getPixelClient().newCanvas(input.width, input.height));
  }
}
