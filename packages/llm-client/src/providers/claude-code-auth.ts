/**
 * Claude Code OAuth 的 token 数据形态与 provider 侧只读凭据端口。
 *
 * 这是 provider 需要的最窄契约：`@kagami/llm-client` 只关心「拿到可用的 access token」，
 * 不关心 token 从哪来、怎么刷新、怎么落库。OAuth 全套（登录 / 回调 / 刷新 / secret store）
 * 由上层 `@kagami/auth` 实现该接口后注入，llm-client 对其零依赖。
 */
export type ClaudeCodeAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

export interface ClaudeCodeAuthProvider {
  hasCredentials(): Promise<boolean>;
  getAuth(options?: { forceRefresh?: boolean }): Promise<ClaudeCodeAuth>;
}
