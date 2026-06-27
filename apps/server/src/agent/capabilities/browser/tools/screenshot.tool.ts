import { z } from "zod";
import { type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { BrowserToolComponent } from "./browser-tool-component.js";
import type { BrowserService } from "../application/browser.service.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const BROWSER_SCREENSHOT_TOOL_NAME = "browser_screenshot";

const Schema = z.object({ reason: z.string().optional() });

/**
 * 截当前视口，**原图直接进多模态上下文**（经 append_message Effect 带 image，不走
 * vision 转文字）。聚焦密码字段时服务层会拒截。语义树(observe)够用就别频繁截图——
 * 截图 token 较贵、会推高压缩频率（见设计「截图预算」）。
 */
export class BrowserScreenshotTool extends BrowserToolComponent<typeof Schema> {
  public readonly name = BROWSER_SCREENSHOT_TOOL_NAME;
  public readonly description =
    "截当前页视口，原图直接进你的上下文（你能直接看到图）。仅在需要视觉判断时用；observe 的语义树够用就别截。登录/支付页慎截（聚焦密码框会被拒）。";
  public readonly parameters = {
    type: "object",
    properties: {
      reason: { type: "string", description: "为什么要截这张（可选，便于你自己记录）。" },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getBrowserService: () => BrowserService;

  public constructor({ getBrowserService }: { getBrowserService: () => BrowserService }) {
    super();
    this.getBrowserService = getBrowserService;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const shot = await this.getBrowserService().screenshot();
    const appendEffect: RootAgentEffect = {
      type: "append_message",
      content: `<browser_screenshot url="${shot.url}"${input.reason ? ` reason="${input.reason}"` : ""} />`,
      image: { content: shot.image, mimeType: shot.mimeType, filename: "screenshot.jpg" },
    };
    return {
      content: JSON.stringify({
        ok: true,
        url: shot.url,
        note: "截图原图已作为下一条消息进入你的上下文。",
      }),
      effects: [appendEffect],
    };
  }
}
