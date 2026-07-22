import BetterSqlite3 from "better-sqlite3";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { sqliteFilePathFromUrl } from "./client.js";

const logger = new AppLogger({ source: "napcat.legacy-migration" });

/**
 * 主库 → napcat.db 的一次性历史数据搬迁（epic #539 子 issue 2）。
 *
 * 语义：
 * - 幂等、按表独立：目标表非空即跳过（说明已搬过或已产生新数据），空表才从主库整搬。
 * - 每表一个事务：要么全量落库、要么保持空表，崩溃后下次启动自动重试，不会出现半表。
 * - 显式列名 + 原始值直拷（不经 JS 解析），字节保真；显式主键让 outbox 的 seq 单调性
 *   与 AUTOINCREMENT 水位（sqlite_sequence）一并延续，SSE Last-Event-ID 回放不受影响。
 * - 主库以独立只读连接打开，绝不写主库；主库中的旧表由 #539 子 issue 5 统一 DROP。
 * - 搬迁量 = retention 窗口内的行数（万级），同步复制在启动瞬间完成。
 *
 * 前置：napcat.db 的 schema 已由 `pnpm --filter @kagami/napcat db:migrate:deploy` 建好
 * （deploy.sh 在拉起进程前执行）；主库文件不存在（全新安装）则整体 no-op。
 */

type TableSpec = {
  table: string;
  /** 与两侧建表 SQL 逐列一致的显式列名（主库 image_asset 曾有 mime 死列，严禁 SELECT *）。 */
  columns: string[];
};

const TABLES: TableSpec[] = [
  {
    table: "napcat_event",
    columns: [
      "id",
      "post_type",
      "message_type",
      "sub_type",
      "user_id",
      "group_id",
      "event_time",
      "payload",
      "created_at",
    ],
  },
  {
    table: "napcat_qq_message",
    columns: [
      "id",
      "message_type",
      "sub_type",
      "group_id",
      "user_id",
      "nickname",
      "message_id",
      "message",
      "event_time",
      "payload",
      "created_at",
    ],
  },
  {
    table: "napcat_event_outbox",
    columns: ["seq", "event", "created_at"],
  },
  {
    table: "image_asset",
    columns: ["id", "file_id", "resid", "description", "created_at"],
  },
];

export function migrateFromLegacyDb({
  napcatDatabaseUrl,
  legacyDatabaseUrl,
}: {
  napcatDatabaseUrl: string;
  legacyDatabaseUrl: string;
}): void {
  const targetPath = sqliteFilePathFromUrl(napcatDatabaseUrl);
  const legacyPath = sqliteFilePathFromUrl(legacyDatabaseUrl);
  if (targetPath === ":memory:" || legacyPath === ":memory:") {
    return;
  }

  let legacy: BetterSqlite3.Database;
  try {
    legacy = new BetterSqlite3(legacyPath, { readonly: true, fileMustExist: true });
  } catch {
    // 主库文件不存在：全新安装，无历史可搬。
    return;
  }

  const target = new BetterSqlite3(targetPath);
  try {
    target.pragma("busy_timeout = 5000");
    for (const spec of TABLES) {
      migrateTable(legacy, target, spec);
    }
  } finally {
    target.close();
    legacy.close();
  }
}

function migrateTable(
  legacy: BetterSqlite3.Database,
  target: BetterSqlite3.Database,
  { table, columns }: TableSpec,
): void {
  const targetCount = countRows(target, table);
  if (targetCount === null || targetCount > 0) {
    // 表不存在（schema 未迁移，防御性跳过）或已有数据（已搬过/已产生新写入）。
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
    return copied;
  });
  const copied = copyAll();

  if (copied !== legacyCount) {
    // 对账失败即中止启动：事务已回滚为空表，下次启动重试，绝不带着缺口继续。
    throw new Error(
      `legacy 搬迁对账失败：${table} 源 ${String(legacyCount)} 行，实拷 ${String(copied)} 行`,
    );
  }

  logger.info("legacy 表搬迁完成", {
    event: "napcat.legacy_migration.table_done",
    table,
    rows: copied,
    durationMs: Date.now() - startedAt,
  });
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
