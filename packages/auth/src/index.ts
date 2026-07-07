import { type AuthUsageLimitsResponse } from "@kagami/llm-api/auth";
import { SharedOAuthCallbackServer } from "./shared/callback-server.js";
import type { ConfigManager } from "@kagami/kernel/config/config.manager";
import type { Database } from "@kagami/persistence/db/client";
import { AuthUsageCacheManager } from "./application/auth-usage-cache.impl.service.js";
import type {
  AuthUsageSnapshotSink,
  AuthUsageSnapshotSinkRecord,
  AuthUsageRefreshOutcome,
} from "./application/auth-usage-snapshot-sink.js";
import { OAuthAuthRefreshScheduler } from "./application/oauth-auth-refresh.scheduler.js";
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
  // OAuth 额度遥测下沉端口（epic #521）。宿主（apps/llm）注入 Metric 实现；缺省 noop。
  authUsageSnapshotSink?: AuthUsageSnapshotSink;
};

export type AuthModule = {
  authServices: {
    codex: OAuthAuthService<"openai-codex">;
    "claude-code": OAuthAuthService<"claude-code">;
  };
  authUsageCacheManager: AuthUsageCacheManager;
  authRefreshSchedulers: OAuthAuthRefreshScheduler[];
  authHandler: AuthHandler;
  callbackServers: SharedOAuthCallbackServer<OAuthAuthService>[];
};

export async function createAuthModule({
  database,
  configManager,
  authUsageSnapshotSink,
}: AuthModuleDeps): Promise<AuthModule> {
  const config = await configManager.config();
  const llmConfig = config.server.llm;

  const codexConfig = {
    ...llmConfig.codexAuth,
    timeoutMs: llmConfig.timeoutMs,
  };
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
    autoRefreshOnGetAuth: false,
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
        capturedAt: null,
      }) satisfies AuthUsageLimitsResponse,
  });
  codexCallbackServer.setAuthService(codexAuthService);

  const claudeCodeConfig = {
    ...llmConfig.claudeCodeAuth,
    timeoutMs: llmConfig.timeoutMs,
  };
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
    autoRefreshOnGetAuth: false,
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
        capturedAt: null,
      }) satisfies AuthUsageLimitsResponse,
  });
  claudeCodeCallbackServer.setAuthService(claudeCodeAuthService);
  const codexAuthRefreshScheduler = new OAuthAuthRefreshScheduler({
    authService: codexAuthService,
    displayName: "Codex",
    logEventPrefix: "codex_auth_refresh_scheduler",
    refreshCheckIntervalMs: codexConfig.refreshCheckIntervalMs,
    refreshLeewayMs: codexConfig.refreshLeewayMs,
  });
  const claudeCodeAuthRefreshScheduler = new OAuthAuthRefreshScheduler({
    authService: claudeCodeAuthService,
    displayName: "Claude Code",
    logEventPrefix: "claude_code_auth_refresh_scheduler",
    refreshCheckIntervalMs: claudeCodeConfig.refreshCheckIntervalMs,
    refreshLeewayMs: claudeCodeConfig.refreshLeewayMs,
  });

  const authUsageCacheManager = new AuthUsageCacheManager({
    claudeCodeAuthService,
    codexAuthService,
    codexBinaryPath: codexConfig.binaryPath,
    authUsageSnapshotSink,
    refreshIntervalMs: llmConfig.authUsageRefreshIntervalMs,
  });
  codexAuthService.setUsageLimitsProvider(async () => {
    return {
      provider: "codex",
      limits: await authUsageCacheManager.getCodexUsageLimits(),
      capturedAt: authUsageCacheManager.getCodexUsageCapturedAt()?.toISOString() ?? null,
    };
  });
  claudeCodeAuthService.setUsageLimitsProvider(async () => {
    return {
      provider: "claude-code",
      limits: await authUsageCacheManager.getClaudeCodeUsageLimits(),
      capturedAt: authUsageCacheManager.getClaudeCodeUsageCapturedAt()?.toISOString() ?? null,
    };
  });
  const authServices: AuthModule["authServices"] = {
    codex: codexAuthService,
    "claude-code": claudeCodeAuthService,
  };

  return {
    authServices,
    authUsageCacheManager,
    authRefreshSchedulers: [codexAuthRefreshScheduler, claudeCodeAuthRefreshScheduler],
    authHandler: new AuthHandler({
      authServices,
      authUsageCacheManager,
    }),
    callbackServers: [codexCallbackServer, claudeCodeCallbackServer],
  };
}

// auth-scheduled-tasks（留在 agent 装配层，因它咬 agent 的 scheduler 领域类型）需要这两个
// 类型来声明 buildAuthScheduledTasks 的入参，故从包顶层导出。
export { AuthUsageCacheManager, OAuthAuthRefreshScheduler };

// OAuth 额度遥测下沉端口：宿主（apps/llm）实现并注入 createAuthModule。本地转出（不用 re-export
// from，仓库禁 export-from），类型在上方 import。
export type { AuthUsageSnapshotSink, AuthUsageSnapshotSinkRecord, AuthUsageRefreshOutcome };
