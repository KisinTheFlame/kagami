import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { serializePixelError } from "../domain/errors.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../../acl/oss-client.js";
import type { PixelClient } from "../../../../acl/pixel-client.js";

const PIXEL_RENDER_TOOL_NAME = "render";

const logger = new AppLogger({ source: "agent.pixel.render" });

const Schema = z.object({});

type Deps = {
  getPixelClient: () => PixelClient;
  /** 渲染图叠加落 OSS 用；缺省（OSS 关闭）时图仍入上下文，只是没有 resid。 */
  ossClient?: OssClient;
};

/**
 * 把当前画布渲染成 PNG，**原图直接进多模态上下文**（append_message 带 image），并叠加落 OSS 拿
 * resid 便于之后 switch(qq) 用 send_resource 发群。镜像 amap static_map / browser screenshot。
 */
export class PixelRenderTool extends ZodToolComponent<typeof Schema> {
  public readonly name = PIXEL_RENDER_TOOL_NAME;
  public readonly description =
    "把当前画布渲染成 PNG 图、直接进你的视野，同时存档返回一个 resid。没有画布时会提示先开画布。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;

  private readonly getPixelClient: () => PixelClient;
  private readonly ossClient: OssClient | undefined;

  public constructor({ getPixelClient, ossClient }: Deps) {
    super();
    this.getPixelClient = getPixelClient;
    this.ossClient = ossClient;
  }

  protected override formatExecutionError(error: unknown): string {
    return serializePixelError(error);
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    const png = await this.getPixelClient().render();
    const resid = await this.tryPutToOss(png);
    const residAttr = resid ? ` resid="${resid}"` : "";
    const appendEffect: RootAgentEffect = {
      type: "append_message",
      content: `<pixel_render${residAttr} />`,
      image: {
        content: png.toString("base64"),
        mimeType: "image/png",
        filename: "pixel.png",
      },
    };
    return {
      content: JSON.stringify({ ok: true }),
      effects: [appendEffect],
    };
  }

  private async tryPutToOss(bytes: Buffer): Promise<string | undefined> {
    if (!this.ossClient) {
      return undefined;
    }
    try {
      return await this.ossClient.putObject({ bytes, mimeType: "image/png" });
    } catch (error) {
      logger.warn("像素画落 OSS 失败，降级为仅入上下文", {
        event: "agent.pixel.render.oss_put_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
