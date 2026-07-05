/**
 * claude-code provider 与 Files API 上传/删除共用的 Anthropic 请求身份常量。
 * 单源维护：CLI 版本 / Anthropic-Version / Anthropic-Beta 滚动时只改这里，避免 messages 与
 * files 两处各写一份、版本漂移导致上传/删除侧静默用旧头被拒（然后降级 base64、悄悄废掉整个特性）。
 */

export const ANTHROPIC_VERSION = "2023-06-01";
export const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.76 (external, sdk-cli)";

// messages（/v1/messages）与 files（上传 /v1/files + 删除 DELETE /v1/files/{id}）三处共用同一 beta 集合。
// 图片走 Files API 需 files-api-2025-04-14，且依赖 OAuth scope 含 user:file_upload
// （见 packages/auth/src/claude-code/oauth.ts）。
export const ANTHROPIC_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "effort-2025-11-24",
  "files-api-2025-04-14",
].join(",");
