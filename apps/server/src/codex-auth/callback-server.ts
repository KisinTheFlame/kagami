import { createServer, type Server } from "node:http";
import { BizError } from "../errors/biz-error.js";
import type { CodexAuthService } from "../service/codex-auth.service.js";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 1455;

type CodexAuthCallbackServerDeps = {
  codexAuthService: CodexAuthService;
};

export class CodexAuthCallbackServer {
  private readonly codexAuthService: CodexAuthService;
  private server: Server | null = null;

  public constructor({ codexAuthService }: CodexAuthCallbackServerDeps) {
    this.codexAuthService = codexAuthService;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost:1455");
      if (request.method !== "GET" || url.pathname !== "/auth/callback") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Missing code or state");
        return;
      }

      try {
        const result = await this.codexAuthService.handleCallback({ code, state });
        response.writeHead(302, {
          Location: result.redirectUrl,
        });
        response.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Callback failed";
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(message);
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
        message: "启动 Codex 本地回调服务失败",
        meta: {
          reason: "CALLBACK_SERVER_START_FAILED",
          port: CALLBACK_PORT,
        },
        cause: error,
      });
    });

    this.server = server;
  }

  public async stop(): Promise<void> {
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
}

export function getCodexAuthCallbackUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `http://localhost:${CALLBACK_PORT}${normalizedPath}`;
}
