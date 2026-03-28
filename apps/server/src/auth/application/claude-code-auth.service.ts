import type { OAuthCallbackInput, OAuthCallbackResult } from "../shared/types.js";
import type { OAuthAuthService } from "./oauth-auth.service.js";

export type HandleClaudeCodeAuthCallbackInput = OAuthCallbackInput;

export type HandleClaudeCodeAuthCallbackResult = OAuthCallbackResult;

export type ClaudeCodeAuthService = OAuthAuthService<"claude-code">;
