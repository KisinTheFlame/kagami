import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { MAX_CANVAS_SIZE } from "@kagami/pixel-api/contract";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

const PIXEL_SET_PIXELS_TOOL_NAME = "set_pixels";

// 与契约 setPixels 的上限一致（整幅画布的格子数）：本地就封顶，超量在 agent 侧即拒，
// 不把巨大数组发出去撞服务端 400（那会被 mapFallbackError 误报成 PIXEL_NOT_READY）。
const MAX_PIXELS = MAX_CANVAS_SIZE * MAX_CANVAS_SIZE;

const Schema = z.object({
  pixels: z
    .array(
      z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        color: z.string().min(1),
      }),
    )
    .min(1)
    .max(MAX_PIXELS),
});

export class PixelSetPixelsTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_SET_PIXELS_TOOL_NAME;
  public readonly description =
    "批量给格子上色。pixels 是 [{x, y, color}, ...]。任一格越界或颜色非法则整批不生效。";
  public readonly parameters = {
    type: "object",
    properties: {
      pixels: {
        type: "array",
        description: "要上色的格子列表，每项 { x, y, color }。",
        maxItems: MAX_PIXELS,
        items: {
          type: "object",
          properties: {
            x: { type: "number", description: "列号，从 0 起。" },
            y: { type: "number", description: "行号，从 0 起。" },
            color: { type: "string", description: "颜色名（见 help 的调色板）。" },
          },
          required: ["x", "y", "color"],
        },
      },
    },
    required: ["pixels"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getPixelClient: () => PixelClient;

  public constructor({ getPixelClient }: { getPixelClient: () => PixelClient }) {
    super();
    this.getPixelClient = getPixelClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    return renderDrawResponse(await this.getPixelClient().setPixels(input.pixels));
  }
}
