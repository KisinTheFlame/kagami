import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { authApiContract } from "@kagami/llm-api/auth-contract";
import { type AuthProvider } from "@kagami/llm-api/auth";
import type { AuthUsageTrendQueryService } from "../application/auth-usage-trend-query.service.js";
import { toInternalAuthProvider } from "../domain/auth-provider.js";
import type { OAuthAuthService } from "../application/oauth-auth.service.js";

type AuthHandlerDeps = {
  authServices: Record<AuthProvider, OAuthAuthService>;
  authUsageTrendQueryService: AuthUsageTrendQueryService;
};

/**
 * OAuth 凭据管理路由（挂载在 kagami-llm 进程）。路由与 schema 的单一事实源在
 * @kagami/llm-api/auth-contract（#279 PR6）；:provider 经契约 params 通道解析，
 * 不再有手动 ParamsSchema.parse。
 */
export class AuthHandler {
  private readonly authServices: Record<AuthProvider, OAuthAuthService>;
  private readonly authUsageTrendQueryService: AuthUsageTrendQueryService;

  public constructor({ authServices, authUsageTrendQueryService }: AuthHandlerDeps) {
    this.authServices = authServices;
    this.authUsageTrendQueryService = authUsageTrendQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, authApiContract.getAuthStatus, ({ params }) =>
      this.authServices[params.provider].getStatus(),
    );

    registerJsonRoute(app, authApiContract.createAuthLoginUrl, ({ params }) =>
      this.authServices[params.provider].createLoginUrl(),
    );

    registerJsonRoute(app, authApiContract.authLogout, ({ params }) =>
      this.authServices[params.provider].logout(),
    );

    registerJsonRoute(app, authApiContract.authRefresh, ({ params }) =>
      this.authServices[params.provider].refresh(),
    );

    registerJsonRoute(app, authApiContract.getAuthUsageLimits, ({ params }) =>
      this.authServices[params.provider].getUsageLimits(),
    );

    registerJsonRoute(app, authApiContract.getAuthUsageTrend, async ({ params, input }) => {
      const status = await this.authServices[params.provider].getStatus();
      return await this.authUsageTrendQueryService.query({
        provider: toInternalAuthProvider(params.provider),
        accountId: status.session?.accountId ?? null,
        range: input.range,
      });
    });
  }
}
