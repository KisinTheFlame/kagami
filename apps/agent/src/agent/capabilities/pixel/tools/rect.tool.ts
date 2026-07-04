import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

export const PIXEL_RECT_TOOL_NAME = "rect";

const Schema = z.object({
  x1: z.number().int().min(0),
  y1: z.number().int().min(0),
  x2: z.number().int().min(0),
  y2: z.number().int().min(0),
  color: z.string().min(1),
  filled: z.boolean().optional(),
});

export class PixelRectTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_RECT_TOOL_NAME;
  public readonly description =
    "画一个矩形，(x1,y1) 与 (x2,y2) 是对角。filled=true 填实，默认只描边。超出画布的部分裁掉。";
  public readonly parameters = {
    type: "object",
    properties: {
      x1: { type: "number", description: "一角列号。" },
      y1: { type: "number", description: "一角行号。" },
      x2: { type: "number", description: "对角列号。" },
      y2: { type: "number", description: "对角行号。" },
      color: { type: "string", description: "颜色名。" },
      filled: { type: "boolean", description: "是否填实；默认 false（只描边）。" },
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
      await this.getPixelClient().rect(
        input.x1,
        input.y1,
        input.x2,
        input.y2,
        input.color,
        input.filled ?? false,
      ),
    );
  }
}
