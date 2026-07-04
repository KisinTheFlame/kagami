import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

export const PIXEL_FILL_TOOL_NAME = "fill";

const Schema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  color: z.string().min(1),
});

export class PixelFillTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_FILL_TOOL_NAME;
  public readonly description =
    "油漆桶：从 (x,y) 出发，把连成一片的同色区域填成新颜色。起点越界会被拒绝。";
  public readonly parameters = {
    type: "object",
    properties: {
      x: { type: "number", description: "起点列号，从 0 起。" },
      y: { type: "number", description: "起点行号，从 0 起。" },
      color: { type: "string", description: "填充颜色名。" },
    },
    required: ["x", "y", "color"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getPixelClient: () => PixelClient;

  public constructor({ getPixelClient }: { getPixelClient: () => PixelClient }) {
    super();
    this.getPixelClient = getPixelClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    return renderDrawResponse(await this.getPixelClient().fill(input.x, input.y, input.color));
  }
}
