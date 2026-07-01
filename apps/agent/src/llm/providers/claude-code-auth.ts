import type { ClaudeCodeAuth, ClaudeCodeAuthProvider } from "@kagami/llm-client";
import type { ClaudeCodeAuthService } from "../../auth/application/claude-code-auth.service.js";

type ClaudeCodeAuthStoreDeps = {
  claudeCodeAuthService: ClaudeCodeAuthService;
};

/**
 * 把 agent 的 `ClaudeCodeAuthService`（OAuth 全套）适配成 `@kagami/llm-client` 的只读凭据端口。
 * 这是 app 装配层的胶水：provider 只吃 `ClaudeCodeAuthProvider` 接口，登录/刷新的具体实现留在 agent。
 */
export class ClaudeCodeAuthStore implements ClaudeCodeAuthProvider {
  private readonly claudeCodeAuthService: ClaudeCodeAuthService;

  public constructor({ claudeCodeAuthService }: ClaudeCodeAuthStoreDeps) {
    this.claudeCodeAuthService = claudeCodeAuthService;
  }

  public async hasCredentials(): Promise<boolean> {
    return this.claudeCodeAuthService.hasCredentials();
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<ClaudeCodeAuth> {
    return this.claudeCodeAuthService.getAuth(options);
  }
}
