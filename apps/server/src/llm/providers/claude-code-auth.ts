import type { ClaudeCodeAuthService } from "../../auth/application/claude-code-auth.service.js";

export type ClaudeCodeAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

type ClaudeCodeAuthStoreDeps = {
  claudeCodeAuthService: ClaudeCodeAuthService;
};

export class ClaudeCodeAuthStore {
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
