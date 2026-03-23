import type {
  OAuthDao,
  CreateOAuthStateInput,
  UpsertOAuthSessionInput,
} from "../auth/shared/types.js";
import type { CodexAuthSessionRecord, CodexOAuthStateRecord } from "../codex-auth/types.js";

export type UpsertCodexAuthSessionInput = UpsertOAuthSessionInput<"openai-codex">;

export type CreateCodexOAuthStateInput = CreateOAuthStateInput;

export type CodexAuthDao = OAuthDao<"openai-codex", CodexAuthSessionRecord, CodexOAuthStateRecord>;
