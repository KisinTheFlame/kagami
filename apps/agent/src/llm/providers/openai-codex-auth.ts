import type { OpenAiCodexAuth, OpenAiCodexAuthProvider } from "@kagami/llm-client";
import type { CodexAuthService } from "../../auth/application/codex-auth.service.js";

type OpenAiCodexAuthStoreDeps = {
  codexAuthService: CodexAuthService;
};

/**
 * 把 agent 的 `CodexAuthService`（OAuth 全套）适配成 `@kagami/llm-client` 的只读凭据端口。
 * app 装配层胶水：provider 只吃 `OpenAiCodexAuthProvider` 接口，登录/刷新实现留在 agent。
 */
export class OpenAiCodexAuthStore implements OpenAiCodexAuthProvider {
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
