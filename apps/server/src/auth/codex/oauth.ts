import { BizError } from "../../common/errors/biz-error.js";
import type { Config } from "../../config/config.loader.js";
import type { PkcePair } from "../shared/pkce.js";
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
  let response: Response;
  try {
    response = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: input.body,
      signal: AbortSignal.timeout(input.config.timeoutMs),
    });
  } catch (error) {
    throw new BizError({
      message: "Codex 登录服务调用失败",
      meta: {
        reason: input.unavailableReason,
      },
      cause: error,
    });
  }

  const rawText = await response.text();
  const parsed = safeParseJson<{
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  }>(rawText);

  if (!response.ok) {
    throw new BizError({
      message:
        response.status === 400 || response.status === 401 || response.status === 403
          ? "Codex 登录当前不可用"
          : "Codex 登录服务调用失败",
      meta: {
        reason: input.unavailableReason,
        status: response.status,
      },
      cause: parsed ?? rawText.slice(0, 500),
    });
  }

  if (!parsed?.access_token || !parsed.refresh_token || typeof parsed.expires_in !== "number") {
    throw new BizError({
      message: "Codex 登录服务返回了无效票据",
      meta: {
        reason: "AUTH_INVALID_RESPONSE",
      },
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

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
