import type { App, AsyncTaskManager, ToolComponent } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { createAtelierGenerateTool } from "../../capabilities/atelier/tools/generate.tool.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { ImageClient } from "../../../acl/image-client.js";
import type { OssClient } from "../../../acl/oss-client.js";

const ATELIER_APP_ID = "atelier";

type AtelierAppDeps = {
  imageClient: ImageClient;
  /** 生成图叠加落 OSS 拿 resid；缺省（OSS 关闭）时图仍进视野、只是没 resid。 */
  ossClient?: OssClient;
  /** 共享异步任务原语：generate 是异步工具，出图后经 onComplete 回流到主 Agent。 */
  asyncTaskManager: AsyncTaskManager;
};

/**
 * 画室 App：把「用 AI 生图」包成 Kagami 桌面上的一个能力单元。结构照抄 PixelApp——薄壳，只组装
 * 一个 generate 工具 + help/onFocus 模板。
 *
 * 与 pixel（她一格格手绘）的区别：atelier 是把文字描述交给 kagami-llm 的生图端点（gpt-image-2，走
 * codex 订阅额度）生成。generate 是**异步**工具：调用立刻回占位、出图后经 `<async_tool_result>` 尾部
 * 追加，原图直接进她的视野。无状态、无独立进程——复用已上线的 llm 服务端点。
 */
export class AtelierApp implements App {
  public readonly id = ATELIER_APP_ID;
  public readonly displayName = "画室";
  public readonly tools: readonly ToolComponent[];

  public constructor({ imageClient, ossClient, asyncTaskManager }: AtelierAppDeps) {
    this.tools = [createAtelierGenerateTool({ imageClient, ossClient, asyncTaskManager })];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/atelier-app-help.hbs");
  }

  /** 进入画室：只给静态定位屏，不做网络 I/O（本地模板渲染，永不因服务未就绪而进不去）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [
      {
        type: "append_message",
        content: renderServerStaticTemplate(import.meta.url, "prompts/atelier-portal.hbs"),
      },
    ];
  }
}
