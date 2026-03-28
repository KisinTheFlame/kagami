import { BizError } from "../../common/errors/biz-error.js";
import type { PkcePair } from "../shared/pkce.js";
import type { ClaudeCodeAuthRuntimeConfig } from "../../config/config.manager.js";
import type { ClaudeCodeTokenResponse } from "./types.js";
export { createPkcePair } from "../shared/pkce.js";

const CLAUDE_CODE_AUTH_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_CODE_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

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
    scope: "org:create_api_key user:profile user:inference",
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
  config: ClaudeCodeAuthRuntimeConfig;
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
  config: ClaudeCodeAuthRuntimeConfig;
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
  config: ClaudeCodeAuthRuntimeConfig;
  unavailableReason: string;
}): Promise<ClaudeCodeTokenResponse> {
  let response: Response;
  try {
    response = await fetch(CLAUDE_CODE_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(input.config.timeoutMs),
    });
  } catch (error) {
    throw new BizError({
      message: "Claude Code 登录服务调用失败",
      meta: {
        reason: input.unavailableReason,
      },
      cause: error,
    });
  }

  const rawText = await response.text();
  const parsed = safeParseJson<ClaudeCodeOAuthTokenApiResponse>(rawText);

  if (!response.ok) {
    throw new BizError({
      message:
        response.status === 400 || response.status === 401 || response.status === 403
          ? "Claude Code 登录当前不可用"
          : "Claude Code 登录服务调用失败",
      meta: {
        reason: input.unavailableReason,
        status: response.status,
      },
      cause: parsed ?? rawText.slice(0, 500),
    });
  }

  if (
    !parsed?.access_token ||
    !parsed.refresh_token ||
    typeof parsed.expires_in !== "number" ||
    !parsed.account?.email_address
  ) {
    throw new BizError({
      message: "Claude Code 登录服务返回了无效票据",
      meta: {
        reason: "AUTH_INVALID_RESPONSE",
      },
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

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
