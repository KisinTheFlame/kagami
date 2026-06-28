import type { OAuthDao, OAuthSessionRecord, OAuthStateRecord } from "./types.js";
import type { CreateOAuthStateInput, UpsertOAuthSessionInput } from "./types.js";

type PrismaOAuthDaoFactoryInput<
  TProvider extends string,
  TSession extends OAuthSessionRecord<TProvider>,
  TState extends OAuthStateRecord,
> = {
  sessionTable: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  stateTable: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  mapSessionRow(row: unknown): TSession;
  mapStateRow(row: unknown): TState;
};

export function createPrismaOAuthDao<
  TProvider extends string,
  TSession extends OAuthSessionRecord<TProvider>,
  TState extends OAuthStateRecord,
>(
  deps: PrismaOAuthDaoFactoryInput<TProvider, TSession, TState>,
): OAuthDao<TProvider, TSession, TState> {
  // 不解构 mapSessionRow / mapStateRow——它们以方法语法声明，解构会触发 unbound-method；
  // 直接通过 deps 调用即可（普通函数依赖，无 this 语义），既满足规则也不改类型。
  // 用 deps 而非 input 命名，避免与下方方法各自的 input 参数同名冲突。
  const { sessionTable, stateTable } = deps;
  return {
    async findSession(sessionProvider: TProvider): Promise<TSession | null> {
      const row = await sessionTable.findUnique({
        where: {
          provider: sessionProvider,
        },
      });

      return row ? deps.mapSessionRow(row) : null;
    },

    async upsertSession(input: UpsertOAuthSessionInput<TProvider>): Promise<TSession> {
      const row = await sessionTable.upsert({
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

      return deps.mapSessionRow(row);
    },

    async createOAuthState(input: CreateOAuthStateInput): Promise<TState> {
      const row = await stateTable.create({
        data: input,
      });

      return deps.mapStateRow(row);
    },

    async findOAuthState(state: string): Promise<TState | null> {
      const row = await stateTable.findUnique({
        where: {
          state,
        },
      });

      return row ? deps.mapStateRow(row) : null;
    },

    async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
      await stateTable.update({
        where: {
          state,
        },
        data: {
          usedAt,
        },
      });
    },

    async deleteExpiredOAuthStates(before: Date): Promise<void> {
      await stateTable.deleteMany({
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
    },
  };
}
