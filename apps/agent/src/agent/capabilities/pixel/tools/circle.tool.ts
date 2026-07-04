import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

export const PIXEL_CIRCLE_TOOL_NAME = "circle";

const Schema = z.object({
  cx: z.number().int().min(0),
  cy: z.number().int().min(0),
  radius: z.number().int().min(0),
  color: z.string().min(1),
  filled: z.boolean().optional(),
});

export class PixelCircleTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_CIRCLE_TOOL_NAME;
  public readonly description =
    "以 (cx,cy) 为圆心、radius 为半径画圆。filled=true 填实，默认只描边。超出画布的部分裁掉。";
  public readonly parameters = {
    type: "object",
    properties: {
      cx: { type: "number", description: "圆心列号。" },
      cy: { type: "number", description: "圆心行号。" },
      radius: { type: "number", description: "半径（格）。" },
      color: { type: "string", description: "颜色名。" },
      filled: { type: "boolean", description: "是否填实；默认 false（只描边）。" },
    },
    required: ["cx", "cy", "radius", "color"],
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
      await this.getPixelClient().circle(
        input.cx,
        input.cy,
        input.radius,
        input.color,
        input.filled ?? false,
      ),
    );
  }
}
