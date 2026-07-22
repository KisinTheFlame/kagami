import BetterSqlite3 from "better-sqlite3";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { sqliteFilePathFromUrl } from "./client.js";

const logger = new AppLogger({ source: "llm.legacy-migration" });

/**
 * 主库 → llm.db 的一次性历史数据搬迁（epic #539 子 issue 3，照抄 napcat 子 issue 2 范式）。
 *
 * 语义：
 * - **完成哨兵**：搬迁全部成功后把 llm.db 的 `PRAGMA user_version` 置 1。此后每次启动
 *   只读一次目标库的 user_version 即返回，**不再打开主库**——也杜绝了「目标表被 retention
 *   清空后重启，被误判为未搬迁而把主库陈旧数据复活」的回归路径。
 * - 按表独立、每表一个事务：目标表非空即跳过；**行数对账在事务内完成**，不符即 throw 让
 *   better-sqlite3 回滚为空表，下次启动整表重试，绝不提交残缺副本。
 * - 显式列名 + 原始值直拷（不经 JS 解析），字节保真。
 * - **自增水位播种**：无论各表是否有行可搬，都把目标库 `sqlite_sequence` 抬到主库水位
 *   （claude_file_cache 主键是 TEXT sha256、无自增，播种自然跳过）。
 * - 主库以独立只读连接打开，绝不写主库；主库中的旧表由 #539 子 issue 5 统一 DROP。
 * - 搬迁失败会中止进程启动（fail-closed）：事务已回滚、无数据损坏，PM2 重启自动重试，
 *   持续失败即 crash-loop 显性暴露，绝不带缺口静默运行。
 *
 * 前置：llm.db 的 schema 已由 `pnpm --filter @kagami/llm-service db:migrate:deploy` 建好
 * （deploy.sh 在停 kagami-llm 后执行、Step 3 再拉起本进程——搬迁发生在旧进程停写主库
 * 之后，故快照必然覆盖其全部写入）；主库文件不存在（全新安装）则直接打哨兵。
 */

/** 搬迁完成标记：llm.db 的 PRAGMA user_version 值。 */
const MIGRATION_DONE_USER_VERSION = 1;

type TableSpec = {
  table: string;
  /** 列清单与两侧建表 SQL 逐列一致，严禁 SELECT *。autoIncrement 表首列为自增主键。 */
  columns: string[];
  /** 是否 INTEGER AUTOINCREMENT 主键（claude_file_cache 是 TEXT sha256 主键，不播种水位）。 */
  autoIncrement: boolean;
};

const TABLES: TableSpec[] = [
  {
    table: "llm_chat_call",
    autoIncrement: true,
    columns: [
      "id",
      "request_id",
      "seq",
      "provider",
      "model",
      "extension",
      "status",
      "request_payload",
      "response_payload",
      "native_request_payload",
      "native_response_payload",
      "error",
      "native_error",
      "latency_ms",
      "created_at",
    ],
  },
  {
    table: "oauth_session",
    autoIncrement: true,
    columns: [
      "id",
      "provider",
      "account_id",
      "email",
      "access_token",
      "refresh_token",
      "id_token",
      "expires_at",
      "last_refresh_at",
      "status",
      "last_error",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "oauth_state",
    autoIncrement: true,
    columns: [
      "id",
      "state",
      "code_verifier",
      "redirect_uri",
      "expires_at",
      "used_at",
      "created_at",
    ],
  },
  {
    table: "embedding_cache",
    autoIncrement: true,
    columns: [
      "id",
      "provider",
      "model",
      "task_type",
      "output_dimensionality",
      "text",
      "text_hash",
      "embedding",
      "created_at",
    ],
  },
  {
    table: "claude_file_cache",
    autoIncrement: false,
    columns: ["content_sha256", "file_id", "mime_type", "size_bytes", "created_at", "last_used_at"],
  },
];

export function migrateFromLegacyDb({
  llmDatabaseUrl,
  legacyDatabaseUrl,
}: {
  llmDatabaseUrl: string;
  legacyDatabaseUrl: string;
}): void {
  const targetPath = sqliteFilePathFromUrl(llmDatabaseUrl);
  const legacyPath = sqliteFilePathFromUrl(legacyDatabaseUrl);
  if (targetPath === ":memory:" || legacyPath === ":memory:") {
    return;
  }

  const target = new BetterSqlite3(targetPath);
  try {
    target.pragma("busy_timeout = 5000");
    const userVersion = readUserVersion(target);
    if (userVersion >= MIGRATION_DONE_USER_VERSION) {
      // 已搬迁完成：常态路径，不打开主库。
      return;
    }

    let legacy: BetterSqlite3.Database;
    try {
      legacy = new BetterSqlite3(legacyPath, { readonly: true, fileMustExist: true });
    } catch {
      // 主库文件不存在：全新安装，无历史可搬，直接打哨兵。
      target.pragma(`user_version = ${String(MIGRATION_DONE_USER_VERSION)}`);
      return;
    }

    try {
      for (const spec of TABLES) {
        migrateTable(legacy, target, spec);
        seedSequenceWatermark(legacy, target, spec);
      }
      target.pragma(`user_version = ${String(MIGRATION_DONE_USER_VERSION)}`);
    } finally {
      legacy.close();
    }
  } finally {
    target.close();
  }
}

function migrateTable(
  legacy: BetterSqlite3.Database,
  target: BetterSqlite3.Database,
  { table, columns }: TableSpec,
): void {
  const targetCount = countRows(target, table);
  if (targetCount === null || targetCount > 0) {
    // 表不存在（schema 未迁移，防御性跳过）或已有数据（此前部分成功后的重试）。
    return;
  }
  const legacyCount = countRows(legacy, table);
  if (legacyCount === null || legacyCount === 0) {
    return;
  }

  const columnList = columns.map(column => `"${column}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const select = legacy.prepare(`SELECT ${columnList} FROM "${table}" ORDER BY "${columns[0]}"`);
  select.raw(true);
  const insert = target.prepare(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`);

  const startedAt = Date.now();
  const copyAll = target.transaction(() => {
    let copied = 0;
    for (const row of select.iterate()) {
      insert.run(...(row as unknown[]));
      copied += 1;
    }
    if (copied !== legacyCount) {
      // 对账必须在事务内：throw 触发回滚，目标表保持空表，下次启动整表重试。
      throw new Error(
        `legacy 搬迁对账失败：${table} 源 ${String(legacyCount)} 行，实拷 ${String(copied)} 行`,
      );
    }
    return copied;
  });
  const copied = copyAll();

  logger.info("legacy 表搬迁完成", {
    event: "llm.legacy_migration.table_done",
    table,
    rows: copied,
    durationMs: Date.now() - startedAt,
  });
}

/**
 * 把目标库该表的自增水位（sqlite_sequence）抬到主库水位，幂等取 max。
 * 即使表无行可搬（如 llm_chat_call 恰好被 retention 清空）也播种，避免新库 id 与
 * 历史 id 空间重叠（照抄 napcat 范式；llm 侧无跨进程游标，此举纯保守）。
 */
function seedSequenceWatermark(
  legacy: BetterSqlite3.Database,
  target: BetterSqlite3.Database,
  { table, columns, autoIncrement }: TableSpec,
): void {
  if (!autoIncrement) {
    return;
  }
  if (countRows(legacy, table) === null || countRows(target, table) === null) {
    return;
  }
  const pk = columns[0] ?? "id";
  const legacySeq = readSequence(legacy, table);
  const legacyMaxPk = readMaxPk(legacy, table, pk);
  const watermark = Math.max(legacySeq, legacyMaxPk);
  if (watermark <= 0) {
    return;
  }
  const targetSeq = Math.max(readSequence(target, table), readMaxPk(target, table, pk));
  if (watermark <= targetSeq) {
    return;
  }
  target
    .prepare("INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)")
    .run(table, watermark);
  logger.info("legacy 自增水位播种完成", {
    event: "llm.legacy_migration.sequence_seeded",
    table,
    watermark,
  });
}

function readUserVersion(database: BetterSqlite3.Database): number {
  const value = database.pragma("user_version", { simple: true });
  return typeof value === "number" ? value : 0;
}

function readSequence(database: BetterSqlite3.Database, table: string): number {
  const row = database.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(table) as
    | { seq: number | bigint | null }
    | undefined;
  return row?.seq ? Number(row.seq) : 0;
}

function readMaxPk(database: BetterSqlite3.Database, table: string, pk: string): number {
  const row = database.prepare(`SELECT MAX("${pk}") AS max FROM "${table}"`).get() as {
    max: number | bigint | null;
  };
  return row.max ? Number(row.max) : 0;
}

/** 表不存在返回 null（源/目标 schema 不齐时防御性跳过），存在返回行数。 */
function countRows(database: BetterSqlite3.Database, table: string): number | null {
  const exists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) {
    return null;
  }
  const row = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
    count: number;
  };
  return row.count;
}
