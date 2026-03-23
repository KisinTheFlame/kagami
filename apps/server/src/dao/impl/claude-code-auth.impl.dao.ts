import type { Database } from "../../db/client.js";
import { createPrismaOAuthDao } from "../../auth/shared/dao.js";
import type { ClaudeCodeAuthDao } from "../claude-code-auth.dao.js";
import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord,
} from "../../claude-code-auth/types.js";

type PrismaClaudeCodeAuthDaoDeps = {
  database: Database;
};

export class PrismaClaudeCodeAuthDao implements ClaudeCodeAuthDao {
  private readonly dao: ClaudeCodeAuthDao;

  public constructor({ database }: PrismaClaudeCodeAuthDaoDeps) {
    this.dao = createPrismaOAuthDao({
      sessionTable: database.claudeCodeAuthSession,
      stateTable: database.claudeCodeOAuthState,
      mapSessionRow: toSessionRecord,
      mapStateRow: toOAuthStateRecord,
    });
  }

  public async findSession(provider: "claude-code"): Promise<ClaudeCodeAuthSessionRecord | null> {
    return await this.dao.findSession(provider);
  }

  public async upsertSession(input: Parameters<ClaudeCodeAuthDao["upsertSession"]>[0]) {
    return await this.dao.upsertSession(input);
  }

  public async createOAuthState(input: Parameters<ClaudeCodeAuthDao["createOAuthState"]>[0]) {
    return await this.dao.createOAuthState(input);
  }

  public async findOAuthState(state: string): Promise<ClaudeCodeOAuthStateRecord | null> {
    return await this.dao.findOAuthState(state);
  }

  public async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.dao.markOAuthStateUsed(state, usedAt);
  }

  public async deleteExpiredOAuthStates(before: Date): Promise<void> {
    await this.dao.deleteExpiredOAuthStates(before);
  }
}

function toSessionRecord(row: {
  id: number;
  provider: string;
  accountId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  status: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ClaudeCodeAuthSessionRecord {
  return {
    id: row.id,
    provider: "claude-code",
    accountId: row.accountId,
    email: row.email,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    idToken: row.idToken,
    expiresAt: row.expiresAt,
    lastRefreshAt: row.lastRefreshAt,
    status: row.status as ClaudeCodeAuthSessionRecord["status"],
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOAuthStateRecord(row: {
  id: number;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}): ClaudeCodeOAuthStateRecord {
  return {
    id: row.id,
    state: row.state,
    codeVerifier: row.codeVerifier,
    redirectUri: row.redirectUri,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
