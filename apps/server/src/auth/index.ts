import type { AuthUsageLimitsResponse } from "@kagami/shared";
import { SharedOAuthCallbackServer } from "./shared/callback-server.js";
import type { ConfigManager } from "../config/config.manager.js";
import type { Database } from "../db/client.js";
import { PrismaAuthUsageSnapshotDao } from "./dao/impl/auth-usage-snapshot.impl.dao.js";
import { DefaultAuthUsageTrendQueryService } from "./application/auth-usage-trend-query.impl.service.js";
import { AuthUsageCacheManager } from "./application/auth-usage-cache.impl.service.js";
import {
  buildClaudeCodeAuthorizeUrl,
  exchangeCodeForTokens as exchangeClaudeCodeTokens,
  refreshClaudeCodeTokens,
} from "./claude-code/oauth.js";
import { PlainTextClaudeCodeAuthSecretStore } from "./claude-code/secret-store.js";
import {
  buildCodexAuthorizeUrl,
  exchangeCodeForTokens as exchangeCodexTokens,
  refreshCodexTokens,
} from "./codex/oauth.js";
import { PlainTextCodexAuthSecretStore } from "./codex/secret-store.js";
import { AuthHandler } from "./http/auth.handler.js";
import {
  DefaultOAuthAuthService,
  type OAuthAuthService,
} from "./application/oauth-auth.service.js";
import { PrismaOAuthDao } from "./infra/prisma-oauth.dao.js";

type AuthModuleDeps = {
  database: Database;
  configManager: ConfigManager;
};

export type AuthModule = {
  authServices: {
    codex: OAuthAuthService<"openai-codex">;
    "claude-code": OAuthAuthService<"claude-code">;
  };
  authUsageCacheManager: AuthUsageCacheManager;
  authHandler: AuthHandler;
  callbackServers: SharedOAuthCallbackServer<OAuthAuthService>[];
};

export async function createAuthModule({
  database,
  configManager,
}: AuthModuleDeps): Promise<AuthModule> {
  const authUsageSnapshotDao = new PrismaAuthUsageSnapshotDao({ database });
  const authUsageTrendQueryService = new DefaultAuthUsageTrendQueryService({
    authUsageSnapshotDao,
  });

  const codexConfig = await configManager.getCodexAuthRuntimeConfig();
  const codexCallbackServer = new SharedOAuthCallbackServer<OAuthAuthService>({
    host: "127.0.0.1",
    port: 1455,
    path: "/auth/callback",
    displayName: "Codex",
  });
  const codexAuthService = new DefaultOAuthAuthService({
    publicProvider: "codex",
    internalProvider: "openai-codex",
    displayName: "Codex",
    managementPath: "/auth/codex",
    dao: new PrismaOAuthDao({
      database,
      provider: "openai-codex",
    }),
    config: codexConfig,
    callbackServer: codexCallbackServer,
    secretStore: new PlainTextCodexAuthSecretStore(),
    protocolAdapter: {
      buildAuthorizeUrl: buildCodexAuthorizeUrl,
      exchangeCodeForTokens: input =>
        exchangeCodexTokens({
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirectUri: input.redirectUri,
          config: input.config,
        }),
      refreshTokens: refreshCodexTokens,
      getRedirectUri: oauthRedirectPath => `http://localhost:1455${oauthRedirectPath}`,
    },
    createEmptyUsageLimits: () =>
      ({
        provider: "codex",
        limits: {
          primary: null,
          secondary: null,
        },
      }) satisfies AuthUsageLimitsResponse,
  });
  codexCallbackServer.setAuthService(codexAuthService);

  const claudeCodeConfig = await configManager.getClaudeCodeAuthRuntimeConfig();
  const claudeCodeCallbackServer = new SharedOAuthCallbackServer<OAuthAuthService>({
    host: "127.0.0.1",
    port: 54545,
    path: "/callback",
    displayName: "Claude Code",
  });
  const claudeCodeAuthService = new DefaultOAuthAuthService({
    publicProvider: "claude-code",
    internalProvider: "claude-code",
    displayName: "Claude Code",
    managementPath: "/auth/claude-code",
    dao: new PrismaOAuthDao({
      database,
      provider: "claude-code",
    }),
    config: claudeCodeConfig,
    callbackServer: claudeCodeCallbackServer,
    secretStore: new PlainTextClaudeCodeAuthSecretStore(),
    protocolAdapter: {
      buildAuthorizeUrl: buildClaudeCodeAuthorizeUrl,
      exchangeCodeForTokens: input =>
        exchangeClaudeCodeTokens({
          code: input.code,
          state: input.state,
          codeVerifier: input.codeVerifier,
          redirectUri: input.redirectUri,
          config: input.config,
        }),
      refreshTokens: refreshClaudeCodeTokens,
      getRedirectUri: () => "http://localhost:54545/callback",
    },
    createEmptyUsageLimits: () =>
      ({
        provider: "claude-code",
        limits: {
          five_hour: null,
          seven_day: null,
          extra_usage: null,
        },
      }) satisfies AuthUsageLimitsResponse,
  });
  claudeCodeCallbackServer.setAuthService(claudeCodeAuthService);

  const authUsageCacheManager = new AuthUsageCacheManager({
    claudeCodeAuthService,
    codexAuthService,
    codexBinaryPath: codexConfig.binaryPath,
    authUsageSnapshotDao,
  });
  codexAuthService.setUsageLimitsProvider(async () => {
    return {
      provider: "codex",
      limits: await authUsageCacheManager.getCodexUsageLimits(),
    };
  });
  claudeCodeAuthService.setUsageLimitsProvider(async () => {
    return {
      provider: "claude-code",
      limits: await authUsageCacheManager.getClaudeCodeUsageLimits(),
    };
  });
  authUsageCacheManager.start();

  const authServices: AuthModule["authServices"] = {
    codex: codexAuthService,
    "claude-code": claudeCodeAuthService,
  };

  return {
    authServices,
    authUsageCacheManager,
    authHandler: new AuthHandler({
      authServices,
      authUsageTrendQueryService,
    }),
    callbackServers: [codexCallbackServer, claudeCodeCallbackServer],
  };
}
