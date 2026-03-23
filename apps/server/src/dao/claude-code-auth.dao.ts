import type {
  OAuthDao,
  CreateOAuthStateInput,
  UpsertOAuthSessionInput,
} from "../auth/shared/types.js";
import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord,
} from "../claude-code-auth/types.js";

export type UpsertClaudeCodeAuthSessionInput = UpsertOAuthSessionInput<"claude-code">;

export type CreateClaudeCodeOAuthStateInput = CreateOAuthStateInput;

export type ClaudeCodeAuthDao = OAuthDao<
  "claude-code",
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord
>;
