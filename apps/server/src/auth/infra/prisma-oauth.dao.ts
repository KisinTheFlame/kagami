import type { Database } from "../../db/client.js";
import { createPrismaOAuthDao } from "../shared/dao.js";
import type { OAuthDao, OAuthSessionRecord, OAuthStateRecord } from "../shared/types.js";
import type { InternalAuthProvider } from "../domain/auth-provider.js";

type PrismaOAuthDaoDeps<TProvider extends InternalAuthProvider> = {
  database: Database;
  provider: TProvider;
};

export class PrismaOAuthDao<TProvider extends InternalAuthProvider> implements OAuthDao<
  TProvider,
  OAuthSessionRecord<TProvider>,
  OAuthStateRecord
> {
  private readonly dao: OAuthDao<TProvider, OAuthSessionRecord<TProvider>, OAuthStateRecord>;

  public constructor({ database }: PrismaOAuthDaoDeps<TProvider>) {
    this.dao = createPrismaOAuthDao({
      sessionTable: database.oauthSession,
      stateTable: database.oauthState,
      mapSessionRow: toSessionRecord,
      mapStateRow: toOAuthStateRecord,
    });
  }

  public async findSession(provider: TProvider): Promise<OAuthSessionRecord<TProvider> | null> {
    return await this.dao.findSession(provider);
  }

  public async upsertSession(
    input: Parameters<OAuthDao<TProvider, OAuthSessionRecord<TProvider>>["upsertSession"]>[0],
  ): Promise<OAuthSessionRecord<TProvider>> {
    return await this.dao.upsertSession(input);
  }

  public async createOAuthState(
    input: Parameters<OAuthDao<TProvider, OAuthSessionRecord<TProvider>>["createOAuthState"]>[0],
  ): Promise<OAuthStateRecord> {
    return await this.dao.createOAuthState(input);
  }

  public async findOAuthState(state: string): Promise<OAuthStateRecord | null> {
    return await this.dao.findOAuthState(state);
  }

  public async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.dao.markOAuthStateUsed(state, usedAt);
  }

  public async deleteExpiredOAuthStates(before: Date): Promise<void> {
    await this.dao.deleteExpiredOAuthStates(before);
  }
}

function toSessionRecord<TProvider extends InternalAuthProvider>(row: {
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
}): OAuthSessionRecord<TProvider> {
  return {
    id: row.id,
    provider: row.provider as TProvider,
    accountId: row.accountId,
    email: row.email,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    idToken: row.idToken,
    expiresAt: row.expiresAt,
    lastRefreshAt: row.lastRefreshAt,
    status: row.status as OAuthSessionRecord<TProvider>["status"],
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
}): OAuthStateRecord {
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
