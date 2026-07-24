import { z } from "zod";
import { type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserClient } from "../../../../acl/browser-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const BROWSER_SCREENSHOT_TOOL_NAME = "browser_screenshot";

const Schema = z.object({});

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
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserClient: () => BrowserClient;
  private readonly ossClient: OssClient | undefined;

  public constructor({
    getBrowserClient,
    ossClient,
  }: {
    getBrowserClient: () => BrowserClient;
    ossClient?: OssClient;
  }) {
    super();
    this.getBrowserClient = getBrowserClient;
    this.ossClient = ossClient;
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    const shot = await this.getBrowserClient().screenshot();
    // 叠加落 OSS：失败不影响截图入上下文（降级，resid 置空）。
    const resid = await this.tryPutToOss(shot.image, shot.mimeType);
    const appendEffect: RootAgentEffect = {
      type: "append_message",
      // 进上下文的伪标签文案走 static 模板（AGENTS.md 红线），TS 只算 view-model。
      content: renderServerStaticTemplate(import.meta.url, "context/browser-screenshot.hbs", {
        url: shot.url,
        resid,
      }).trim(),
      // content 用 base64 字符串：图片要进持久上下文（快照/ledger 走 JSON），Buffer 会被 JSON 毒坏。
      images: [
        {
          content: shot.image.toString("base64"),
          mimeType: shot.mimeType,
          filename: "screenshot.jpg",
        },
      ],
    };
    return {
      content: JSON.stringify({ ok: true }),
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
