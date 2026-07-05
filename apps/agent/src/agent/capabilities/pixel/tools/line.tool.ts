import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

const PIXEL_LINE_TOOL_NAME = "line";

const Schema = z.object({
  x1: z.number().int().min(0),
  y1: z.number().int().min(0),
  x2: z.number().int().min(0),
  y2: z.number().int().min(0),
  color: z.string().min(1),
});

export class PixelLineTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_LINE_TOOL_NAME;
  public readonly description = "从 (x1,y1) 到 (x2,y2) 画一条直线。超出画布的部分会被裁掉。";
  public readonly parameters = {
    type: "object",
    properties: {
      x1: { type: "number", description: "起点列号。" },
      y1: { type: "number", description: "起点行号。" },
      x2: { type: "number", description: "终点列号。" },
      y2: { type: "number", description: "终点行号。" },
      color: { type: "string", description: "线的颜色名。" },
    },
    required: ["x1", "y1", "x2", "y2", "color"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getPixelClient: () => PixelClient;

  public constructor({ getPixelClient }: { getPixelClient: () => PixelClient }) {
    super();
    this.getPixelClient = getPixelClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    return renderDrawResponse(
      await this.getPixelClient().line(input.x1, input.y1, input.x2, input.y2, input.color),
    );
  }
}
