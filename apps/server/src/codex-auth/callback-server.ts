import {
  SharedOAuthCallbackServer,
  buildOAuthCallbackUrl,
} from "../auth/shared/callback-server.js";
import type { CodexAuthService } from "../service/codex-auth.service.js";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";

export class CodexAuthCallbackServer {
  private readonly server: SharedOAuthCallbackServer<CodexAuthService>;

  public constructor() {
    this.server = new SharedOAuthCallbackServer({
      host: CALLBACK_HOST,
      port: CALLBACK_PORT,
      path: CALLBACK_PATH,
      displayName: "Codex",
    });
  }

  public setAuthService(codexAuthService: CodexAuthService): void {
    this.server.setAuthService(codexAuthService);
  }

  public async start(): Promise<void> {
    await this.server.start();
  }

  public async beginAuthorizationWindow(ttlMs: number): Promise<void> {
    await this.server.beginAuthorizationWindow(ttlMs);
  }

  public async stop(): Promise<void> {
    await this.server.stop();
  }
}

export function getCodexAuthCallbackUrl(pathname: string): string {
  return buildOAuthCallbackUrl(
    {
      port: CALLBACK_PORT,
      path: CALLBACK_PATH,
    },
    pathname,
  );
}
