import { z } from "zod";
import { type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/server-core/logger/logger";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserService } from "../application/browser.service.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../../oss/oss-client.js";

export const BROWSER_SCREENSHOT_TOOL_NAME = "browser_screenshot";

const Schema = z.object({ reason: z.string().optional() });

const logger = new AppLogger({ source: "agent.browser.screenshot" });

/**
 * 截当前视口，**原图直接进多模态上下文**（经 append_message Effect 带 image，不走
 * vision 转文字）。聚焦密码字段时服务层会拒截。语义树(observe)够用就别频繁截图——
 * 截图 token 较贵、会推高压缩频率（见设计「截图预算」）。
 *
 * 叠加式落 OSS：截图同时 PUT 进 OSS 拿一个 resId 一并回给你，方便日后 send_resource
 * 转发或 read_resource 重看。OSS 关闭或 PUT 失败只是少了 resId，截图照常入上下文（降级）。
 */
export class BrowserScreenshotTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_SCREENSHOT_TOOL_NAME;
  public readonly description =
    "截当前页视口，原图直接进你的上下文（你能直接看到图），并落 OSS 返回 resid 便于日后转发/重看。仅在需要视觉判断时用；observe 的语义树够用就别截。登录/支付页慎截（聚焦密码框会被拒）。";
  public readonly parameters = {
    type: "object",
    properties: {
      reason: { type: "string", description: "为什么要截这张（可选，便于你自己记录）。" },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserService: () => BrowserService;
  private readonly ossClient: OssClient | undefined;

  public constructor({
    getBrowserService,
    ossClient,
  }: {
    getBrowserService: () => BrowserService;
    ossClient?: OssClient;
  }) {
    super();
    this.getBrowserService = getBrowserService;
    this.ossClient = ossClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const shot = await this.getBrowserService().screenshot();
    // 叠加落 OSS：失败不影响截图入上下文（降级，resid 置空）。
    const resid = await this.tryPutToOss(shot.image, shot.mimeType);
    const reasonAttr = input.reason ? ` reason="${input.reason}"` : "";
    const residAttr = resid ? ` resid="${resid}"` : "";
    const appendEffect: RootAgentEffect = {
      type: "append_message",
      content: `<browser_screenshot url="${shot.url}"${reasonAttr}${residAttr} />`,
      // content 用 base64 字符串：图片要进持久上下文（快照/ledger 走 JSON），Buffer 会被 JSON 毒坏。
      image: {
        content: shot.image.toString("base64"),
        mimeType: shot.mimeType,
        filename: "screenshot.jpg",
      },
    };
    return {
      content: JSON.stringify({
        ok: true,
        url: shot.url,
        ...(resid ? { resid } : {}),
        note: resid
          ? "截图原图已进入你的上下文；已存档，可用 send_resource 转发或 read_resource 重看。"
          : "截图原图已进入你的上下文（本次未落 OSS，无 resid）。",
      }),
      effects: [appendEffect],
    };
  }

  private async tryPutToOss(bytes: Buffer, mimeType: string): Promise<string | undefined> {
    if (!this.ossClient) {
      return undefined;
    }
    try {
      return await this.ossClient.putObject({ bytes, mimeType });
    } catch (error) {
      logger.warn("截图落 OSS 失败，降级为仅入上下文", {
        event: "agent.browser.screenshot.oss_put_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
