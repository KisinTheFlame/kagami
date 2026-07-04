import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { PixelToolComponent } from "./pixel-tool-component.js";
import { renderDrawResponse } from "../render/pixel-screen.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

export const PIXEL_CLEAR_TOOL_NAME = "clear";

const Schema = z.object({});

export class PixelClearTool extends PixelToolComponent<typeof Schema> {
  public readonly name = PIXEL_CLEAR_TOOL_NAME;
  public readonly description =
    "清空当前画布（所有格子变空/透明），保留画布尺寸。没有画布时会提示先开画布。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getPixelClient: () => PixelClient;

  public constructor({ getPixelClient }: { getPixelClient: () => PixelClient }) {
    super();
    this.getPixelClient = getPixelClient;
  }

  protected async executeTyped(): Promise<string> {
    return renderDrawResponse(await this.getPixelClient().clear());
  }
}
