import { createPrismaOAuthDao } from "../shared/dao.js";
import type { OAuthDao, OAuthSessionRecord, OAuthStateRecord } from "../shared/types.js";
import type { InternalAuthProvider } from "../domain/auth-provider.js";

/**
 * auth 对宿主数据库的最小结构端口（epic #539 子 issue 3）：只要求 oauth 两表的 Prisma
 * delegate 形状，不绑定任何具体 generated client——oauth 表归宿主（kagami-llm）的独占库，
 * 由宿主注入自己的 Prisma client 即可满足，auth 包对 @kagami/persistence 零依赖。
 */
export type OAuthDatabase = {
  // 方法简写声明：TS 对 method 参数做双变检查，具体 Prisma delegate（参数为各自 Args 类型）
  // 可结构性赋给 unknown 形参——与 shared/dao.ts 的 factory 入参形状一致（已被原实现验证）。
  oauthSession: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  oauthState: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
};

type PrismaOAuthDaoDeps<TProvider extends InternalAuthProvider> = {
  database: OAuthDatabase;
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
