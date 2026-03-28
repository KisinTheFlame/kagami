import type { OAuthCallbackInput, OAuthCallbackResult } from "../auth/shared/types.js";
import type { OAuthAuthService } from "../modules/auth/application/oauth-auth.service.js";

export type HandleCodexAuthCallbackInput = OAuthCallbackInput;

export type HandleCodexAuthCallbackResult = OAuthCallbackResult;

export type CodexAuthService = OAuthAuthService<"openai-codex">;
