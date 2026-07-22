import type { ToolExecutionResult } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../../acl/oss-client.js";

const logger = new AppLogger({ source: "agent.gba.screen" });

type GbaScreenMeta = {
  timelineId: string;
  capturedFrame: number;
  startFrame?: number;
  releasedFrame?: number;
};

/**
 * 把 GBA 服务回传的 base64 PNG 装配成工具结果：**原图直接进多模态上下文**（append_message 带
 * image），叠加落 OSS 拿 resid 便于之后 switch(qq) 用 send_resource 发群（镜像 pixel render）。
 * tool_result 的 content 只含元数据 JSON，**绝不含 base64**（CLAUDE.md 红线：大块数据不进
 * 主 Agent 消息列表）。帧号/时间线元数据帮助诊断「决策-执行漂移」（实时运行下画面在推理间隙
 * 继续变化），timelineId 在换游戏/服务重启时更换。
 */
export async function buildGbaScreenToolResult({
  imageBase64,
  meta,
  ossClient,
}: {
  imageBase64: string;
  meta: GbaScreenMeta;
  ossClient: OssClient | undefined;
}): Promise<ToolExecutionResult> {
  const png = Buffer.from(imageBase64, "base64");
  const resid = await tryPutToOss(png, ossClient);
  const residAttr = resid ? ` resid="${resid}"` : "";
  const appendEffect: RootAgentEffect = {
    type: "append_message",
    content: `<gba_screen${residAttr} timeline="${meta.timelineId}" frame="${meta.capturedFrame}" />`,
    image: {
      content: imageBase64,
      mimeType: "image/png",
      filename: "gba.png",
    },
  };
  return {
    content: JSON.stringify({
      ok: true,
      timelineId: meta.timelineId,
      ...(meta.startFrame === undefined ? {} : { startFrame: meta.startFrame }),
      ...(meta.releasedFrame === undefined ? {} : { releasedFrame: meta.releasedFrame }),
      capturedFrame: meta.capturedFrame,
      ...(resid ? { resid } : {}),
    }),
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
