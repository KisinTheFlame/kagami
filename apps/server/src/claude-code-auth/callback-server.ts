import {
  SharedOAuthCallbackServer,
  buildOAuthCallbackUrl,
} from "../auth/shared/callback-server.js";
import type { ClaudeCodeAuthService } from "../service/claude-code-auth.service.js";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 54545;
const CALLBACK_PATH = "/callback";

export class ClaudeCodeAuthCallbackServer {
  private readonly server: SharedOAuthCallbackServer<ClaudeCodeAuthService>;

  public constructor() {
    this.server = new SharedOAuthCallbackServer({
      host: CALLBACK_HOST,
      port: CALLBACK_PORT,
      path: CALLBACK_PATH,
      displayName: "Claude Code",
    });
  }

  public setAuthService(claudeCodeAuthService: ClaudeCodeAuthService): void {
    this.server.setAuthService(claudeCodeAuthService);
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

export function getClaudeCodeAuthCallbackUrl(): string {
  return buildOAuthCallbackUrl({
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
  });
}
