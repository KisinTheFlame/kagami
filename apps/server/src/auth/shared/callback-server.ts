import { createServer, type Server } from "node:http";
import { BizError } from "../../errors/biz-error.js";
import type { OAuthCallbackHandler, OAuthCallbackInput, OAuthCallbackServerLike } from "./types.js";

type OAuthCallbackServerConfig = {
  host: string;
  port: number;
  path: string;
  displayName: string;
};

export class SharedOAuthCallbackServer<
  TService extends OAuthCallbackHandler,
> implements OAuthCallbackServerLike {
  private readonly config: OAuthCallbackServerConfig;
  private authService: TService | null = null;
  private server: Server | null = null;
  private stopTimer: NodeJS.Timeout | null = null;

  public constructor(config: OAuthCallbackServerConfig) {
    this.config = config;
  }

  public setAuthService(authService: TService): void {
    this.authService = authService;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const authService = this.authService;
    if (!authService) {
      throw new BizError({
        message: `${this.config.displayName} 回调服务未绑定认证服务`,
        meta: {
          reason: "CALLBACK_SERVER_SERVICE_UNBOUND",
        },
      });
    }

    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost:${this.config.port}`);
      if (request.method !== "GET" || url.pathname !== this.config.path) {
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
        const result = await authService.handleCallback({
          code,
          state,
        } satisfies OAuthCallbackInput);
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
      server.listen(this.config.port, this.config.host, () => {
        server.off("error", reject);
        resolve();
      });
    }).catch(error => {
      throw new BizError({
        message: `启动 ${this.config.displayName} 本地回调服务失败`,
        meta: {
          reason: "CALLBACK_SERVER_START_FAILED",
          port: this.config.port,
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

export function buildOAuthCallbackUrl(
  config: Pick<OAuthCallbackServerConfig, "port" | "path">,
  pathname = config.path,
): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `http://localhost:${config.port}${normalizedPath}`;
}
