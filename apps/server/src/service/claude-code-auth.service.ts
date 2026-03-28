import type { OAuthCallbackInput, OAuthCallbackResult } from "../auth/shared/types.js";
import type { OAuthAuthService } from "../modules/auth/application/oauth-auth.service.js";

export type HandleClaudeCodeAuthCallbackInput = OAuthCallbackInput;

export type HandleClaudeCodeAuthCallbackResult = OAuthCallbackResult;

export type ClaudeCodeAuthService = OAuthAuthService<"claude-code">;
