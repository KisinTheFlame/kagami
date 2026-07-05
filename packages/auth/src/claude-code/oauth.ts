import type { Config } from "@kagami/kernel/config/config.loader";
import type { PkcePair } from "../shared/pkce.js";
import { invalidOAuthTicketError, postOAuthTokenRequest } from "../shared/oauth-token-request.js";
import type { ClaudeCodeTokenResponse } from "./types.js";

const CLAUDE_CODE_AUTH_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_CODE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

type ClaudeCodeAuthConfig = Config["server"]["llm"]["claudeCodeAuth"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

type ClaudeCodeOAuthTokenApiResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  account?: {
    uuid?: string;
    email_address?: string;
  };
};

export type ClaudeCodePkcePair = PkcePair;

export function buildClaudeCodeAuthorizeUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CODE_CLIENT_ID,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: "org:create_api_key user:profile user:inference user:file_upload",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${CLAUDE_CODE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(input: {
  code: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  config: ClaudeCodeAuthConfig;
}): Promise<ClaudeCodeTokenResponse> {
  const { code, state: callbackState } = parseCodeAndState(input.code);
  const payload: Record<string, string> = {
    code,
    state: callbackState || input.state,
    grant_type: "authorization_code",
    client_id: CLAUDE_CODE_CLIENT_ID,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  };

  return requestClaudeCodeTokens({
    payload,
    config: input.config,
    unavailableReason: "AUTH_CODE_EXCHANGE_FAILED",
  });
}

export async function refreshClaudeCodeTokens(input: {
  refreshToken: string;
  config: ClaudeCodeAuthConfig;
}): Promise<ClaudeCodeTokenResponse> {
  return requestClaudeCodeTokens({
    payload: {
      client_id: CLAUDE_CODE_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    },
    config: input.config,
    unavailableReason: "AUTH_REFRESH_UNAVAILABLE",
  });
}

async function requestClaudeCodeTokens(input: {
  payload: Record<string, string>;
  config: ClaudeCodeAuthConfig;
  unavailableReason: string;
}): Promise<ClaudeCodeTokenResponse> {
  const { parsed, rawText } = await postOAuthTokenRequest<ClaudeCodeOAuthTokenApiResponse>({
    tokenUrl: CLAUDE_CODE_TOKEN_URL,
    providerLabel: "Claude Code",
    body: { kind: "json", payload: input.payload },
    timeoutMs: input.config.timeoutMs,
    unavailableReason: input.unavailableReason,
  });

  if (
    !parsed?.access_token ||
    !parsed.refresh_token ||
    typeof parsed.expires_in !== "number" ||
    !parsed.account?.email_address
  ) {
    throw invalidOAuthTicketError({
      providerLabel: "Claude Code",
      cause: parsed ?? rawText.slice(0, 500),
    });
  }

  const now = new Date();
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    accountId: parsed.account.uuid,
    email: parsed.account.email_address,
    expiresAt: new Date(now.getTime() + parsed.expires_in * 1000),
    lastRefreshAt: now,
  };
}

function parseCodeAndState(code: string): { code: string; state: string } {
  const [parsedCode, parsedState = ""] = code.split("#");
  return {
    code: parsedCode,
    state: parsedState,
  };
}
