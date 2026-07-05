import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

const PIXEL_ELLIPSE_TOOL_NAME = "ellipse";

const Schema = z.object({
  cx: z.number().int().min(0),
  cy: z.number().int().min(0),
  rx: z.number().int().min(0),
  ry: z.number().int().min(0),
  color: z.string().min(1),
  filled: z.boolean().optional(),
});

export class PixelEllipseTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_ELLIPSE_TOOL_NAME;
  public readonly description =
    "以 (cx,cy) 为心画椭圆，rx 是横半径、ry 是竖半径。filled=true 填实，默认只描边。超出画布的部分裁掉。";
  public readonly parameters = {
    type: "object",
    properties: {
      cx: { type: "number", description: "中心列号。" },
      cy: { type: "number", description: "中心行号。" },
      rx: { type: "number", description: "横半径（格）。" },
      ry: { type: "number", description: "竖半径（格）。" },
      color: { type: "string", description: "颜色名。" },
      filled: { type: "boolean", description: "是否填实；默认 false（只描边）。" },
    },
    required: ["cx", "cy", "rx", "ry", "color"],
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
      await this.getPixelClient().ellipse(
        input.cx,
        input.cy,
        input.rx,
        input.ry,
        input.color,
        input.filled ?? false,
      ),
    );
  }
}
