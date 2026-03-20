import type { CodexAuthService } from "../../service/codex-auth.service.js";

export type OpenAiCodexAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

type OpenAiCodexAuthStoreDeps = {
  codexAuthService: CodexAuthService;
};

export class OpenAiCodexAuthStore {
  private readonly codexAuthService: CodexAuthService;

  public constructor({ codexAuthService }: OpenAiCodexAuthStoreDeps) {
    this.codexAuthService = codexAuthService;
  }

  public async hasCredentials(): Promise<boolean> {
    return this.codexAuthService.hasCredentials();
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<OpenAiCodexAuth> {
    return this.codexAuthService.getAuth(options);
  }
}
