import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";

/**
 * vision 固定系统指令：进 API `system` 字段的稳定前缀（#594）。对所有 vision 调用逐字节恒定，
 * 才能被 claude-code 的 system 缓存断点覆盖、跨调用命中 prompt cache，故不接任何每次会变的参数。
 * 切片场景的 tileCount 走 createVisionTileNote 进 user turn，绝不进这段被缓存的前缀。
 */
export function createVisionSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/vision-system.hbs").trim();
}

/**
 * 切片说明：极端长图切片后（#556）告诉 vision「这 N 张是同一张图的分片」。带每次会变的 tileCount，
 * 必须放进 user turn（图片之前）、绝不进被缓存的 system 前缀（KV 缓存红线，#594）。
 */
export function createVisionTileNote({ tileCount }: { tileCount: number }): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/vision-tile-note.hbs", {
    tileCount,
  }).trim();
}
