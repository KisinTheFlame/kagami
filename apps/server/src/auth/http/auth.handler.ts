import {
  AuthLoginUrlResponseSchema,
  AuthLogoutResponseSchema,
  AuthProviderSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthUsageLimitsResponseSchema,
  AuthUsageTrendQuerySchema,
  AuthUsageTrendResponseSchema,
} from "@kagami/shared";
import type { AuthProvider } from "@kagami/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthUsageTrendQueryService } from "../application/auth-usage-trend-query.service.js";
import { registerCommandRoute, registerQueryRoute } from "../../common/http/route.helper.js";
import { toInternalAuthProvider } from "../domain/auth-provider.js";
import type { OAuthAuthService } from "../application/oauth-auth.service.js";

const ParamsSchema = z
  .object({
    provider: AuthProviderSchema,
  })
  .strict();
const EmptyBodySchema = z.object({}).strict();
const EmptyQuerySchema = z.object({}).strict();

type AuthHandlerDeps = {
  authServices: Record<AuthProvider, OAuthAuthService>;
  authUsageTrendQueryService: AuthUsageTrendQueryService;
};

export class AuthHandler {
  public readonly prefix = "/auth";
  private readonly authServices: Record<AuthProvider, OAuthAuthService>;
  private readonly authUsageTrendQueryService: AuthUsageTrendQueryService;

  public constructor({ authServices, authUsageTrendQueryService }: AuthHandlerDeps) {
    this.authServices = authServices;
    this.authUsageTrendQueryService = authUsageTrendQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/:provider/status`,
      querySchema: EmptyQuerySchema,
      responseSchema: AuthStatusResponseSchema,
      execute: ({ request }) => this.getService(request.params).getStatus(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/:provider/login-url`,
      bodySchema: EmptyBodySchema,
      responseSchema: AuthLoginUrlResponseSchema,
      execute: ({ request }) => this.getService(request.params).createLoginUrl(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/:provider/logout`,
      bodySchema: EmptyBodySchema,
      responseSchema: AuthLogoutResponseSchema,
      execute: ({ request }) => this.getService(request.params).logout(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/:provider/refresh`,
      bodySchema: EmptyBodySchema,
      responseSchema: AuthRefreshResponseSchema,
      execute: ({ request }) => this.getService(request.params).refresh(),
    });

    registerQueryRoute({
      app,
      path: `${this.prefix}/:provider/usage-limits`,
      querySchema: EmptyQuerySchema,
      responseSchema: AuthUsageLimitsResponseSchema,
      execute: ({ request }) => this.getService(request.params).getUsageLimits(),
    });

    registerQueryRoute({
      app,
      path: `${this.prefix}/:provider/usage-trend`,
      querySchema: AuthUsageTrendQuerySchema,
      responseSchema: AuthUsageTrendResponseSchema,
      execute: async ({ request, query }) => {
        const provider = ParamsSchema.parse(request.params).provider;
        const status = await this.authServices[provider].getStatus();
        return await this.authUsageTrendQueryService.query({
          provider: toInternalAuthProvider(provider),
          accountId: status.session?.accountId ?? null,
          range: query.range,
        });
      },
    });
  }

  private getService(params: unknown): OAuthAuthService {
    const parsed = ParamsSchema.parse(params);
    return this.authServices[parsed.provider];
  }
}
