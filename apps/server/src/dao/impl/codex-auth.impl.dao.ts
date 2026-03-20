import type { Database } from "../../db/client.js";
import type {
  CodexAuthDao,
  CreateCodexOAuthStateInput,
  UpsertCodexAuthSessionInput,
} from "../codex-auth.dao.js";
import type { CodexAuthSessionRecord, CodexOAuthStateRecord } from "../../codex-auth/types.js";

type PrismaCodexAuthDaoDeps = {
  database: Database;
};

export class PrismaCodexAuthDao implements CodexAuthDao {
  private readonly database: Database;

  public constructor({ database }: PrismaCodexAuthDaoDeps) {
    this.database = database;
  }

  public async findSession(provider: "openai-codex"): Promise<CodexAuthSessionRecord | null> {
    const row = await this.database.codexAuthSession.findUnique({
      where: {
        provider,
      },
    });

    return row ? toSessionRecord(row) : null;
  }

  public async upsertSession(input: UpsertCodexAuthSessionInput): Promise<CodexAuthSessionRecord> {
    const row = await this.database.codexAuthSession.upsert({
      where: {
        provider: input.provider,
      },
      update: {
        accountId: input.accountId,
        email: input.email,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
        updatedAt: new Date(),
      },
      create: {
        provider: input.provider,
        accountId: input.accountId,
        email: input.email,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
      },
    });

    return toSessionRecord(row);
  }

  public async createOAuthState(input: CreateCodexOAuthStateInput): Promise<CodexOAuthStateRecord> {
    const row = await this.database.codexOAuthState.create({
      data: {
        state: input.state,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
      },
    });

    return toOAuthStateRecord(row);
  }

  public async findOAuthState(state: string): Promise<CodexOAuthStateRecord | null> {
    const row = await this.database.codexOAuthState.findUnique({
      where: {
        state,
      },
    });

    return row ? toOAuthStateRecord(row) : null;
  }

  public async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.database.codexOAuthState.update({
      where: {
        state,
      },
      data: {
        usedAt,
      },
    });
  }

  public async deleteExpiredOAuthStates(before: Date): Promise<void> {
    await this.database.codexOAuthState.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lt: before,
            },
          },
          {
            usedAt: {
              not: null,
            },
          },
        ],
      },
    });
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
