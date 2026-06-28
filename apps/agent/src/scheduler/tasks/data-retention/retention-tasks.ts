import type { Database } from "@kagami/server-core/db/client";

/**
 * `findMany` / `deleteMany` subset of a Prisma delegate that this factory needs.
 *
 * Retention targets all use `Int @id @default(autoincrement())`, so the id type
 * is narrowed to `number` here.
 */
export type PrismaRetentionDelegate = {
  findMany(args: {
    where: Record<string, { lt: Date }>;
    select: { id: true };
    take: number;
  }): Promise<Array<{ id: number }>>;
  deleteMany(args: { where: { id: { in: number[] } } }): Promise<{ count: number }>;
};

export type RetentionSpec = {
  /** Physical table name, used as the data-retention task's suffix (e.g. `data-retention:app_log`). */
  displayName: string;
  /** Prisma model field used in the `<field> < threshold` predicate. */
  field: string;
  /** Retention horizon in days. */
  days: number;
  /** Stagger offset in minutes, combined with the 00:00 base cron to form `<offset> 0 * * *`. */
  offsetMinutes: number;
  /**
   * Pick the Prisma delegate for this table. Returns `unknown` because each
   * concrete delegate has a model-specific `findMany`/`deleteMany` signature
   * that does not structurally match the loose {@link PrismaRetentionDelegate};
   * the single narrowing cast lives at the call site in the task factory.
   */
  getDelegate: (db: Database) => unknown;
};

/**
 * Tables cleared by the data-retention scheduler. Edit this list to change the
 * cleanup surface — no config file, no enum, no Zod schema. Developers know
 * which tables are logs/metrics/caches and which are Agent memory.
 *
 * Intentionally NOT cleaned up (not in this list):
 * - `linear_message_ledger` — Story Agent's source-of-truth message ledger
 * - `story` / `story_memory_document` — Agent long-term memory
 * - `root_agent_runtime_snapshot` / `story_agent_runtime_snapshot` — runtime snapshots
 * - `oauth_session` — persistent auth state
 * - `ithome_article` / `ithome_feed_cursor` — RSS articles (see TODOS.md for deferred strategy)
 * - `metric_chart` — chart definitions (meta, not data)
 *
 * Field choices worth noting:
 * - `metric` uses `createdAt`, not `occurredAt`. The latter is only indexed as the
 *   trailing column of the composite `(metric_name, occurred_at)` index, so a
 *   single-column `occurred_at < x` predicate cannot seek it.
 * - `auth_usage_snapshot` keeps 30 days (not 7) so the `/auth/:provider/usage-trend`
 *   window stays usable.
 * - `embedding_cache` keeps 30 days to avoid evicting hot hash hits that would
 *   trigger re-embed API calls.
 * - `oauth_state` uses `expiresAt` because it has a single-column index; `createdAt`
 *   does not. Since a state row expires ~10 minutes after creation, `expiresAt < now - 7d`
 *   is equivalent to `createdAt < now - 7d` in practice.
 */
export const RETENTION_TASKS: readonly RetentionSpec[] = [
  {
    displayName: "app_log",
    field: "createdAt",
    days: 7,
    offsetMinutes: 0,
    getDelegate: db => db.appLog,
  },
  {
    displayName: "llm_chat_call",
    field: "createdAt",
    days: 3,
    offsetMinutes: 5,
    getDelegate: db => db.llmChatCall,
  },
  {
    displayName: "metric",
    field: "createdAt",
    days: 7,
    offsetMinutes: 10,
    getDelegate: db => db.metric,
  },
  {
    displayName: "napcat_event",
    field: "createdAt",
    days: 7,
    offsetMinutes: 15,
    getDelegate: db => db.napcatEvent,
  },
  {
    displayName: "napcat_qq_message",
    field: "createdAt",
    days: 7,
    offsetMinutes: 20,
    getDelegate: db => db.napcatQqMessage,
  },
  {
    displayName: "terminal_output",
    field: "createdAt",
    days: 7,
    offsetMinutes: 25,
    getDelegate: db => db.terminalOutput,
  },
  {
    displayName: "auth_usage_snapshot",
    field: "capturedAt",
    days: 30,
    offsetMinutes: 30,
    getDelegate: db => db.authUsageSnapshot,
  },
  {
    displayName: "embedding_cache",
    field: "createdAt",
    days: 30,
    offsetMinutes: 35,
    getDelegate: db => db.embeddingCache,
  },
  {
    displayName: "oauth_state",
    field: "expiresAt",
    days: 7,
    offsetMinutes: 40,
    getDelegate: db => db.oauthState,
  },
];
