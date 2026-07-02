import type { Config } from "@kagami/kernel/config/config.loader";
import type { PkcePair } from "../shared/pkce.js";
import { invalidOAuthTicketError, postOAuthTokenRequest } from "../shared/oauth-token-request.js";
import type { CodexTokenResponse } from "./types.js";

const CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

type CodexAuthConfig = Config["server"]["llm"]["codexAuth"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

type JwtClaims = {
  email?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

export type CodexPkcePair = PkcePair;

export function buildCodexAuthorizeUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: "openid email profile offline_access",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    prompt: "login",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });

  return `${CODEX_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  config: Pick<CodexAuthConfig, "timeoutMs">;
}): Promise<CodexTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CODEX_CLIENT_ID,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });

  return requestCodexTokens({
    body,
    config: input.config,
    unavailableReason: "AUTH_CODE_EXCHANGE_FAILED",
  });
}

export async function refreshCodexTokens(input: {
  refreshToken: string;
  config: Pick<CodexAuthConfig, "timeoutMs">;
}): Promise<CodexTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: CODEX_CLIENT_ID,
    scope: "openid profile email",
  });

  return requestCodexTokens({
    body,
    config: input.config,
    unavailableReason: "AUTH_REFRESH_UNAVAILABLE",
  });
}

async function requestCodexTokens(input: {
  body: URLSearchParams;
  config: Pick<CodexAuthConfig, "timeoutMs">;
  unavailableReason: string;
}): Promise<CodexTokenResponse> {
  const { parsed, rawText } = await postOAuthTokenRequest<{
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  }>({
    tokenUrl: CODEX_TOKEN_URL,
    providerLabel: "Codex",
    body: { kind: "form", params: input.body },
    timeoutMs: input.config.timeoutMs,
    unavailableReason: input.unavailableReason,
  });

  if (!parsed?.access_token || !parsed.refresh_token || typeof parsed.expires_in !== "number") {
    throw invalidOAuthTicketError({
      providerLabel: "Codex",
      cause: parsed ?? rawText.slice(0, 500),
    });
  }

  const claims = parsed.id_token ? parseJwtClaims(parsed.id_token) : null;
  const now = new Date();

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    idToken: parsed.id_token,
    accountId: claims?.["https://api.openai.com/auth"]?.chatgpt_account_id,
    email: claims?.email,
    expiresAt: new Date(now.getTime() + parsed.expires_in * 1000),
    lastRefreshAt: now,
  };
}

function parseJwtClaims(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as JwtClaims;
  } catch {
    return null;
  }
}
