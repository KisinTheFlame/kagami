import type { OAuthDao, OAuthSessionRecord, OAuthStateRecord } from "./types.js";
import type { CreateOAuthStateInput, UpsertOAuthSessionInput } from "./types.js";

type PrismaOAuthDaoFactoryInput<
  TProvider extends string,
  TSession extends OAuthSessionRecord<TProvider>,
  TState extends OAuthStateRecord,
> = {
  sessionTable: {
    findUnique(args: unknown): Promise<unknown | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  stateTable: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown | null>;
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
>({
  sessionTable,
  stateTable,
  mapSessionRow,
  mapStateRow,
}: PrismaOAuthDaoFactoryInput<TProvider, TSession, TState>): OAuthDao<TProvider, TSession, TState> {
  return {
    async findSession(sessionProvider: TProvider): Promise<TSession | null> {
      const row = await sessionTable.findUnique({
        where: {
          provider: sessionProvider,
        },
      });

      return row ? mapSessionRow(row) : null;
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

      return mapSessionRow(row);
    },

    async createOAuthState(input: CreateOAuthStateInput): Promise<TState> {
      const row = await stateTable.create({
        data: input,
      });

      return mapStateRow(row);
    },

    async findOAuthState(state: string): Promise<TState | null> {
      const row = await stateTable.findUnique({
        where: {
          state,
        },
      });

      return row ? mapStateRow(row) : null;
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
