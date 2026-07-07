import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { authApiContract } from "@kagami/llm-api/auth-contract";
import { type AuthProvider } from "@kagami/llm-api/auth";
import type { AuthUsageCacheManager } from "../application/auth-usage-cache.impl.service.js";
import type { OAuthAuthService } from "../application/oauth-auth.service.js";

type AuthHandlerDeps = {
  authServices: Record<AuthProvider, OAuthAuthService>;
  authUsageCacheManager: AuthUsageCacheManager;
};

/**
 * OAuth 凭据管理路由（挂载在 kagami-llm 进程）。路由与 schema 的单一事实源在
 * @kagami/llm-api/auth-contract（#279 PR6）；:provider 经契约 params 通道解析，
 * 不再有手动 ParamsSchema.parse。
 */
export class AuthHandler {
  private readonly authServices: Record<AuthProvider, OAuthAuthService>;
  private readonly authUsageCacheManager: AuthUsageCacheManager;

  public constructor({ authServices, authUsageCacheManager }: AuthHandlerDeps) {
    this.authServices = authServices;
    this.authUsageCacheManager = authUsageCacheManager;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, authApiContract.getAuthStatus, ({ params }) =>
      this.authServices[params.provider].getStatus(),
    );

    registerJsonRoute(app, authApiContract.createAuthLoginUrl, ({ params }) =>
      this.authServices[params.provider].createLoginUrl(),
    );

    registerJsonRoute(app, authApiContract.authLogout, async ({ params }) => {
      const result = await this.authServices[params.provider].logout();
      // 登出即刻撤额度缓存，不等下一轮后台刷新（否则登出后前端 refetch 仍拿到旧卡，epic #521）。
      if (params.provider === "codex") {
        this.authUsageCacheManager.clearCodexUsage();
      } else {
        this.authUsageCacheManager.clearClaudeCodeUsage();
      }
      return result;
    });

    registerJsonRoute(app, authApiContract.authRefresh, ({ params }) =>
      this.authServices[params.provider].refresh(),
    );

    registerJsonRoute(app, authApiContract.getAuthUsageLimits, ({ params }) =>
      this.authServices[params.provider].getUsageLimits(),
    );
  }
}
