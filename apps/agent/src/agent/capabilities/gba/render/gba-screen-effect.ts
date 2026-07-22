import type { ToolExecutionResult } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const logger = new AppLogger({ source: "agent.gba.screen" });

/**
 * 把 GBA 服务回传的 base64 PNG 装配成工具结果：**原图直接进多模态上下文**（append_message 带
 * image），叠加落 OSS 拿 resid 便于之后 switch(qq) 用 send_resource 发群（镜像 pixel render）。
 *
 * 响应内容按「她看了有什么用」裁剪（用户反馈 2026-07-22）：她的下一步行动只依赖**画面本身**
 * 与 resid（发 QQ 用）,timelineId / 帧号这类诊断元数据属于服务端日志与 llm_chat_call,不进
 * 她的上下文;resid 只写在贴着图的标签里,content 不重复携带。tool_result content 恒为
 * `{"ok":true}`（ReAct 要求每个 tool_call 有 tool_result;失败路径由 GbaToolComponent 的
 * 冻结结构错误负责）。
 */
export async function buildGbaScreenToolResult({
  imageBase64,
  ossClient,
}: {
  imageBase64: string;
  ossClient: OssClient | undefined;
}): Promise<ToolExecutionResult> {
  const png = Buffer.from(imageBase64, "base64");
  const resid = await tryPutToOss(png, ossClient);
  const residAttr = resid ? ` resid="${resid}"` : "";
  const appendEffect: RootAgentEffect = {
    type: "append_message",
    content: `<gba_screen${residAttr} />`,
    image: {
      content: imageBase64,
      mimeType: "image/png",
      filename: "gba.png",
    },
  };
  return {
    content: JSON.stringify({ ok: true }),
    effects: [appendEffect],
  };
}

async function tryPutToOss(
  bytes: Buffer,
  ossClient: OssClient | undefined,
): Promise<string | undefined> {
  if (!ossClient) {
    return undefined;
  }
  try {
    return await ossClient.putObject({ bytes, mimeType: "image/png" });
  } catch (error) {
    logger.warn("GBA 截图落 OSS 失败，降级为仅入上下文", {
      event: "agent.gba.screen.oss_put_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
