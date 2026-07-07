import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { PALETTE_NAMES } from "@kagami/pixel-api/palette";
import { PixelNewCanvasTool } from "../../capabilities/pixel/tools/new-canvas.tool.js";
import { PixelSetPixelsTool } from "../../capabilities/pixel/tools/set-pixels.tool.js";
import { PixelFillTool } from "../../capabilities/pixel/tools/fill.tool.js";
import { PixelLineTool } from "../../capabilities/pixel/tools/line.tool.js";
import { PixelRectTool } from "../../capabilities/pixel/tools/rect.tool.js";
import { PixelCircleTool } from "../../capabilities/pixel/tools/circle.tool.js";
import { PixelEllipseTool } from "../../capabilities/pixel/tools/ellipse.tool.js";
import { PixelClearTool } from "../../capabilities/pixel/tools/clear.tool.js";
import { PixelRenderTool } from "../../capabilities/pixel/tools/render.tool.js";
import { renderPixelPortal } from "../../capabilities/pixel/render/pixel-screen.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../acl/oss-client.js";
import type { PixelClient } from "../../../acl/pixel-client.js";

const PIXEL_APP_ID = "pixel";

type PixelAppDeps = {
  /** 绘图动作客户端：打到独立的 kagami-pixel 进程（issue #365）。 */
  pixelClient: PixelClient;
  /** 渲染图叠加落 OSS 用；缺省（OSS 关闭）时图仍入上下文，只是没有 resid。 */
  ossClient?: OssClient;
};

/**
 * 像素画 App：把画布的 9 个工具包成 Kagami 桌面上的一个能力单元。结构照抄 SpireApp / BrowserApp。
 *
 * 拆进程（issue #365）：本 App 不持有画布，只持有一个打到独立 kagami-pixel 进程的 HttpPixelClient。
 * 画布状态归游戏进程独占并落 JSON 存档，agent 重启不丢画布。
 *
 * - 工具：new_canvas / set_pixels / fill / line / rect / circle / ellipse / clear / render。
 * - canInvoke 恒 true（粗门控）：颜色 / 坐标是否合法由服务权威裁定，非法回一条可读拒绝。
 * - onFocus 只给静态定位屏，不做网络 I/O（永不因服务未就绪而进不去）；要看画面就 render 出真图。
 * - 无状态持久化：画布归服务进程独占，本 App 无 exportState/restoreState。
 *
 * 设计依据：仓库根 AGENTS.md + issue #365。
 */
export class PixelApp implements App {
  public readonly id = PIXEL_APP_ID;
  public readonly displayName = "像素画";
  public readonly description = "在画布上逐格填色作画，导出为图。";
  public readonly tools: readonly [
    PixelNewCanvasTool,
    PixelSetPixelsTool,
    PixelFillTool,
    PixelLineTool,
    PixelRectTool,
    PixelCircleTool,
    PixelEllipseTool,
    PixelClearTool,
    PixelRenderTool,
  ];

  public constructor({ pixelClient, ossClient }: PixelAppDeps) {
    const getPixelClient = (): PixelClient => pixelClient;
    this.tools = [
      new PixelNewCanvasTool({ getPixelClient }),
      new PixelSetPixelsTool({ getPixelClient }),
      new PixelFillTool({ getPixelClient }),
      new PixelLineTool({ getPixelClient }),
      new PixelRectTool({ getPixelClient }),
      new PixelCircleTool({ getPixelClient }),
      new PixelEllipseTool({ getPixelClient }),
      new PixelClearTool({ getPixelClient }),
      new PixelRenderTool({ getPixelClient, ossClient }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/pixel-app-help.hbs", {
      palette: PALETTE_NAMES.join("、"),
    });
  }

  /** 进入像素画：只给静态定位屏，不做网络 I/O（本地模板渲染，永不因服务未起而进不去）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [{ type: "append_message", content: renderPixelPortal() }];
  }
}
