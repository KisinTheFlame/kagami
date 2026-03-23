import type { Database } from "../../db/client.js";
import { createPrismaOAuthDao } from "../../auth/shared/dao.js";
import type { CodexAuthDao } from "../codex-auth.dao.js";
import type { CodexAuthSessionRecord, CodexOAuthStateRecord } from "../../codex-auth/types.js";

type PrismaCodexAuthDaoDeps = {
  database: Database;
};

export class PrismaCodexAuthDao implements CodexAuthDao {
  private readonly dao: CodexAuthDao;

  public constructor({ database }: PrismaCodexAuthDaoDeps) {
    this.dao = createPrismaOAuthDao({
      sessionTable: database.codexAuthSession,
      stateTable: database.codexOAuthState,
      mapSessionRow: toSessionRecord,
      mapStateRow: toOAuthStateRecord,
    });
  }

  public async findSession(provider: "openai-codex"): Promise<CodexAuthSessionRecord | null> {
    return await this.dao.findSession(provider);
  }

  public async upsertSession(input: Parameters<CodexAuthDao["upsertSession"]>[0]) {
    return await this.dao.upsertSession(input);
  }

  public async createOAuthState(input: Parameters<CodexAuthDao["createOAuthState"]>[0]) {
    return await this.dao.createOAuthState(input);
  }

  public async findOAuthState(state: string): Promise<CodexOAuthStateRecord | null> {
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
}): CodexAuthSessionRecord {
  return {
    id: row.id,
    provider: "openai-codex",
    accountId: row.accountId,
    email: row.email,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    idToken: row.idToken,
    expiresAt: row.expiresAt,
    lastRefreshAt: row.lastRefreshAt,
    status: row.status as CodexAuthSessionRecord["status"],
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
}): CodexOAuthStateRecord {
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
