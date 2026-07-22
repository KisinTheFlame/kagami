import { z } from "zod";
import type { ToolExecutionResult, ToolKind } from "@kagami/agent-runtime";
import { GbaToolComponent } from "./gba-tool-component.js";
import { buildGbaScreenToolResult } from "../render/gba-screen-effect.js";
import { withForegroundRealign } from "./foreground-realign.js";
import type { GbaClient } from "../../../../acl/gba-client.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const GBA_SCREENSHOT_TOOL_NAME = "screenshot";

const Schema = z.object({});

type Deps = {
  getGbaClient: () => GbaClient;
  ossClient?: OssClient;
};

export class GbaScreenshotTool extends GbaToolComponent<typeof Schema> {
  public readonly name = GBA_SCREENSHOT_TOOL_NAME;
  public readonly description =
    "看一眼当前画面（不按任何键）。游戏实时运行,你思考期间画面可能已经变了——不确定动画放完没、要做不可逆操作（存档/确认）前,先用它看一眼再按。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getGbaClient: () => GbaClient;
  private readonly ossClient: OssClient | undefined;

  public constructor({ getGbaClient, ossClient }: Deps) {
    super();
    this.getGbaClient = getGbaClient;
    this.ossClient = ossClient;
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    const client = this.getGbaClient();
    const outcome = await withForegroundRealign(client, () => client.screenshot());
    return buildGbaScreenToolResult({
      imageBase64: outcome.imageBase64,
      meta: outcome,
      ossClient: this.ossClient,
    });
  }
}
