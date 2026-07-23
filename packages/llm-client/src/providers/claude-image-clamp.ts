import { AppLogger } from "@kagami/kernel/logger/logger";
import { clampToApiLimit } from "@kagami/image/normalize";
import type { LlmChatRequest, LlmMessage, LlmContentPart } from "../types.js";

/**
 * wire 层图片保险丝（#556）：请求发出前把所有超限图片（单边 >7900px 或总像素 >40MP）
 * 确定性降采样进 Anthropic 限制内。这是最后一道防线——入口层（napcat / read_resource）
 * 的归一化漏掉的任何来源，到这里也不可能再把 400 毒消息送进持久上下文（2026-07-23 事故：
 * 429×8183 长截图每轮 400 死循环 6 小时）。
 *
 * 确定性：同输入字节 → 同输出字节，跨轮次稳定，因此下游 Files API 的 sha256 缓存照常
 * 命中、KV 前缀不漂移。解码失败的图原样透传（保持现状行为，不引入新的丢图路径）。
 * 全部图片合法时原样返回入参 request（零拷贝、零重编码）。
 */

const logger = new AppLogger({ source: "claude-image-clamp" });

export async function clampRequestImages(request: LlmChatRequest): Promise<LlmChatRequest> {
  let changed = false;
  const messages: LlmMessage[] = await Promise.all(
    request.messages.map(async message => {
      if (message.role !== "user" || typeof message.content === "string") {
        return message;
      }
      const parts: LlmContentPart[] = await Promise.all(
        message.content.map(async part => {
          if (part.type !== "image") {
            return part;
          }
          const clamped = await clampImagePart(part);
          if (clamped !== part) {
            changed = true;
          }
          return clamped;
        }),
      );
      return { ...message, content: parts };
    }),
  );
  return changed ? { ...request, messages } : request;
}

async function clampImagePart(
  part: Extract<LlmContentPart, { type: "image" }>,
): Promise<LlmContentPart> {
  try {
    const bytes = Buffer.from(part.content, "base64");
    if (bytes.byteLength === 0) {
      return part;
    }
    const result = await clampToApiLimit(bytes, part.mimeType);
    if (!result.clamped) {
      return part;
    }
    // 日志 best-effort：logger runtime 未初始化（如测试环境）绝不能吞掉降采样结果。
    try {
      logger.warn("图片超过 API 尺寸限制，wire 层已降采样（入口层归一化漏网，建议排查来源）", {
        event: "llm.claude_code.image_clamped",
        filename: part.filename,
        fromWidth: result.fromSize?.width,
        fromHeight: result.fromSize?.height,
        toWidth: result.toSize?.width,
        toHeight: result.toSize?.height,
      });
    } catch {
      // 忽略日志失败。
    }
    return {
      ...part,
      content: result.bytes.toString("base64"),
      mimeType: result.mimeType,
    };
  } catch (error) {
    // fail-open：保险丝自身故障绝不拦请求，维持既有行为。
    try {
      logger.warn("图片保险丝处理失败，原样透传", {
        event: "llm.claude_code.image_clamp_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // logger runtime 未初始化的上下文里忽略日志失败。
    }
    return part;
  }
}
