import type { OAuthCallbackInput, OAuthCallbackResult } from "../shared/types.js";
import type { OAuthAuthService } from "./oauth-auth.service.js";

export type HandleCodexAuthCallbackInput = OAuthCallbackInput;

export type HandleCodexAuthCallbackResult = OAuthCallbackResult;

export type CodexAuthService = OAuthAuthService<"openai-codex">;
