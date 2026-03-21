import { createServer, type Server } from "node:http";
import { BizError } from "../errors/biz-error.js";
import type { ClaudeCodeAuthService } from "../service/claude-code-auth.service.js";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 54545;
const CALLBACK_PATH = "/callback";

export class ClaudeCodeAuthCallbackServer {
  private claudeCodeAuthService: ClaudeCodeAuthService | null = null;
  private server: Server | null = null;
  private stopTimer: NodeJS.Timeout | null = null;

  public constructor() {}

  public setAuthService(claudeCodeAuthService: ClaudeCodeAuthService): void {
    this.claudeCodeAuthService = claudeCodeAuthService;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const authService = this.claudeCodeAuthService;
    if (!authService) {
      throw new BizError({
        message: "Claude Code 回调服务未绑定认证服务",
        meta: {
          reason: "CALLBACK_SERVER_SERVICE_UNBOUND",
        },
      });
    }

    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
      if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Missing code or state");
        queueMicrotask(() => {
          void this.stop();
        });
        return;
      }

      try {
        const result = await authService.handleCallback({ code, state });
        response.writeHead(302, {
          Location: result.redirectUrl,
        });
        response.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Callback failed";
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(message);
      } finally {
        queueMicrotask(() => {
          void this.stop();
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
        server.off("error", reject);
        resolve();
      });
    }).catch(error => {
      throw new BizError({
        message: "启动 Claude Code 本地回调服务失败",
        meta: {
          reason: "CALLBACK_SERVER_START_FAILED",
          port: CALLBACK_PORT,
        },
        cause: error,
      });
    });

    this.server = server;
  }

  public async beginAuthorizationWindow(ttlMs: number): Promise<void> {
    await this.start();
    this.resetStopTimer(ttlMs);
  }

  public async stop(): Promise<void> {
    this.clearStopTimer();

    if (!this.server) {
      return;
    }

    const activeServer = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      activeServer.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private resetStopTimer(ttlMs: number): void {
    this.clearStopTimer();
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      void this.stop();
    }, ttlMs);
  }

  private clearStopTimer(): void {
    if (!this.stopTimer) {
      return;
    }

    clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }
}

export function getClaudeCodeAuthCallbackUrl(): string {
  return `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
}
