import { existsSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { sqliteFilePathFromUrl } from "./client.js";

const logger = new AppLogger({ source: "napcat.legacy-migration" });

/**
 * 主库 → napcat.db 的一次性历史数据搬迁（epic #539 子 issue 2）。
 *
 * 语义：
 * - **完成哨兵**：搬迁全部成功后把 napcat.db 的 `PRAGMA user_version` 置 1。此后每次启动
 *   只读一次目标库的 user_version 即返回，**不再打开主库**——也杜绝了「目标表被 retention
 *   清空后重启，被误判为未搬迁而把主库陈旧数据复活」的回归路径。
 * - 按表独立、每表一个事务：目标表非空即跳过；**行数对账在事务内完成**，不符即 throw 让
 *   better-sqlite3 回滚为空表，下次启动整表重试，绝不提交残缺副本。
 * - 显式列名 + 原始值直拷（不经 JS 解析），字节保真。
 * - **自增水位播种**：无论各表是否有行可搬，都把目标库 `sqlite_sequence` 抬到主库水位。
 *   关键是 outbox 的 `seq`——它是 SSE 的 Last-Event-ID，若新库从 1 重新编号，agent 持有的
 *   旧游标会把所有新事件当作「已见过」丢弃。
 * - 主库以独立只读连接打开，绝不写主库；主库中的旧表由 #539 子 issue 5 统一 DROP。
 * - 搬迁失败会中止进程启动（fail-closed）：事务已回滚、无数据损坏，PM2 重启自动重试，
 *   持续失败即 crash-loop 显性暴露，绝不带缺口静默运行。
 *
 * 前置：napcat.db 的 schema 已由 `pnpm --filter @kagami/napcat db:migrate:deploy` 建好
 * （deploy.sh Step 2b 在停 kagami-napcat 后执行、Step 3 再拉起本进程——搬迁发生在旧进程
 * 停写主库之后，故快照必然覆盖其全部写入）；主库文件不存在（全新安装）则直接打哨兵。
 */

/** 搬迁完成标记：napcat.db 的 PRAGMA user_version 值。 */
const MIGRATION_DONE_USER_VERSION = 1;

type TableSpec = {
  table: string;
  /** 首列为自增主键；列清单与两侧建表 SQL 逐列一致（主库 image_asset 曾有 mime 死列，严禁 SELECT *）。 */
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

  const target = new BetterSqlite3(targetPath);
  try {
    target.pragma("busy_timeout = 5000");
    const userVersion = readUserVersion(target);
    if (userVersion >= MIGRATION_DONE_USER_VERSION) {
      // 已搬迁完成：常态路径，不打开主库。
      return;
    }

    if (!existsSync(legacyPath)) {
      // 主库文件不存在：全新安装，无历史可搬，直接打哨兵。
      target.pragma(`user_version = ${String(MIGRATION_DONE_USER_VERSION)}`);
      return;
    }
    // 文件存在则任何打开失败（持锁 / 权限 / 损坏）都如实冒泡中止启动——绝不能把真实错误
    // 误判成「无历史可搬」而打哨兵，那会让一次性搬迁被永久短路。
    const legacy = new BetterSqlite3(legacyPath, { readonly: true, fileMustExist: true });

    try {
      for (const spec of TABLES) {
        // 目标表缺失 = schema 尚未 migrate（deploy 迁移失败后被回滚拉起、或单服务部署跳过
        // 迁移）。此时绝不能打哨兵——否则 schema 修好后搬迁被永久跳过、历史与 outbox 水位
        // 静默丢失。fail-closed 中止启动，交 deploy/PM2 重试。
        if (countRows(target, spec.table) === null) {
          throw new Error(`legacy 搬迁中止：目标库缺表 ${spec.table}（schema 未迁移，不打哨兵）`);
        }
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
    // 已有数据（此前部分成功后的重试）即跳过；表不存在的情形已在上层 fail-closed 拦截。
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
    event: "napcat.legacy_migration.table_done",
    table,
    rows: copied,
    durationMs: Date.now() - startedAt,
  });
}

/**
 * 把目标库该表的自增水位（sqlite_sequence）抬到主库水位，幂等取 max。
 * 即使表无行可搬（如 outbox 恰好被 prune/消费清空）也必须播种——outbox 的 seq 是
 * SSE Last-Event-ID，从 1 重新编号会让 agent 的旧游标把新事件全部当已读丢弃。
 */
function seedSequenceWatermark(
  legacy: BetterSqlite3.Database,
  target: BetterSqlite3.Database,
  { table, columns }: TableSpec,
): void {
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
    event: "napcat.legacy_migration.sequence_seeded",
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
