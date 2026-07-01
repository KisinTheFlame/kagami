/**
 * OpenAI Codex OAuth 的 token 数据形态与 provider 侧只读凭据端口。
 *
 * 与 [[claude-code-auth]] 同理：provider 只吃「拿到 access token」这个最窄契约，
 * OAuth 全套由上层 `@kagami/auth` 实现该接口后注入。
 */
export type OpenAiCodexAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

export interface OpenAiCodexAuthProvider {
  hasCredentials(): Promise<boolean>;
  getAuth(options?: { forceRefresh?: boolean }): Promise<OpenAiCodexAuth>;
}
