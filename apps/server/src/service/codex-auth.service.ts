import type {
  CodexAuthLoginUrlResponse,
  CodexAuthLogoutResponse,
  CodexAuthRefreshResponse,
  CodexAuthStatusResponse,
} from "@kagami/shared";
import type { CodexProviderAuth } from "../codex-auth/types.js";

export type HandleCodexAuthCallbackInput = {
  code: string;
  state: string;
};

export type HandleCodexAuthCallbackResult = {
  redirectUrl: string;
};

export interface CodexAuthService {
  getStatus(): Promise<CodexAuthStatusResponse>;
  createLoginUrl(): Promise<CodexAuthLoginUrlResponse>;
  handleCallback(input: HandleCodexAuthCallbackInput): Promise<HandleCodexAuthCallbackResult>;
  logout(): Promise<CodexAuthLogoutResponse>;
  refresh(): Promise<CodexAuthRefreshResponse>;
  hasCredentials(): Promise<boolean>;
  getAuth(options?: { forceRefresh?: boolean }): Promise<CodexProviderAuth>;
}
