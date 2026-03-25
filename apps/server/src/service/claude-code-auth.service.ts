import type {
  ClaudeCodeAuthLoginUrlResponse,
  ClaudeCodeAuthLogoutResponse,
  ClaudeCodeAuthRefreshResponse,
  ClaudeCodeAuthStatusResponse,
  ClaudeCodeUsageLimitsResponse,
} from "@kagami/shared";
import type { ClaudeCodeProviderAuth } from "../claude-code-auth/types.js";

export type HandleClaudeCodeAuthCallbackInput = {
  code: string;
  state: string;
};

export type HandleClaudeCodeAuthCallbackResult = {
  redirectUrl: string;
};

export interface ClaudeCodeAuthService {
  getStatus(): Promise<ClaudeCodeAuthStatusResponse>;
  createLoginUrl(): Promise<ClaudeCodeAuthLoginUrlResponse>;
  handleCallback(
    input: HandleClaudeCodeAuthCallbackInput,
  ): Promise<HandleClaudeCodeAuthCallbackResult>;
  logout(): Promise<ClaudeCodeAuthLogoutResponse>;
  refresh(): Promise<ClaudeCodeAuthRefreshResponse>;
  getUsageLimits(): Promise<ClaudeCodeUsageLimitsResponse>;
  hasCredentials(): Promise<boolean>;
  getAuthWithoutRefresh(): Promise<ClaudeCodeProviderAuth>;
  getAuth(options?: { forceRefresh?: boolean }): Promise<ClaudeCodeProviderAuth>;
}
