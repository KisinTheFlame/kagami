import type { Database } from "../../db/client.js";
import type {
  ClaudeCodeAuthDao,
  CreateClaudeCodeOAuthStateInput,
  UpsertClaudeCodeAuthSessionInput,
} from "../claude-code-auth.dao.js";
import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord,
} from "../../claude-code-auth/types.js";

type PrismaClaudeCodeAuthDaoDeps = {
  database: Database;
};

export class PrismaClaudeCodeAuthDao implements ClaudeCodeAuthDao {
  private readonly database: Database;

  public constructor({ database }: PrismaClaudeCodeAuthDaoDeps) {
    this.database = database;
  }

  public async findSession(provider: "claude-code"): Promise<ClaudeCodeAuthSessionRecord | null> {
    const row = await this.database.claudeCodeAuthSession.findUnique({
      where: {
        provider,
      },
    });

    return row ? toSessionRecord(row) : null;
  }

  public async upsertSession(
    input: UpsertClaudeCodeAuthSessionInput,
  ): Promise<ClaudeCodeAuthSessionRecord> {
    const row = await this.database.claudeCodeAuthSession.upsert({
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

  public async createOAuthState(
    input: CreateClaudeCodeOAuthStateInput,
  ): Promise<ClaudeCodeOAuthStateRecord> {
    const row = await this.database.claudeCodeOAuthState.create({
      data: {
        state: input.state,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
      },
    });

    return toOAuthStateRecord(row);
  }

  public async findOAuthState(state: string): Promise<ClaudeCodeOAuthStateRecord | null> {
    const row = await this.database.claudeCodeOAuthState.findUnique({
      where: {
        state,
      },
    });

    return row ? toOAuthStateRecord(row) : null;
  }

  public async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.database.claudeCodeOAuthState.update({
      where: {
        state,
      },
      data: {
        usedAt,
      },
    });
  }

  public async deleteExpiredOAuthStates(before: Date): Promise<void> {
    await this.database.claudeCodeOAuthState.deleteMany({
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
