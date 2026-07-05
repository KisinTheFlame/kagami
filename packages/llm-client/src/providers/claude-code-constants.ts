/**
 * claude-code provider 与 Files API 上传共用的 Anthropic 请求身份常量。
 * 单源维护：CLI 版本 / Anthropic-Version 滚动时只改这里，避免 messages 与 files 两处
 * 各写一份、版本漂移导致上传侧静默用旧 UA 被拒（然后降级 base64、悄悄废掉整个特性）。
 */

export const ANTHROPIC_VERSION = "2023-06-01";
export const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.76 (external, sdk-cli)";
