/**
 * 一次性补迁：把首轮迁移中被丢弃的 8 张「瞬时表」（日志 / 指标 / 群消息历史 / LLM 历史 /
 * 事件 / 用量快照 / oauth_state / 终端输出）从旧 PostgreSQL **追加**到当前 SQLite。
 *
 * 为什么是追加而非整库重灌：切换后生产已运行在 SQLite，ledger 等关键表比冻结的 PG 更新；
 * 整库重灌会回滚这些表。故这里只动这 8 张表，且 **不清空**、**不指定 id**（自增追加，
 * 保留切换后已写入的少量行）。这 8 张表都没有被其它表外键引用其 id。
 *
 * 内存安全：按 id 分页流式读 PG（每页 batch 行），逐页写入，绝不一次性把整表读进内存
 * （llm_chat_call 单条 request_payload 可达 ~1MB）。
 *
 * 幂等：每表若 SQLite 现有行数已 >= PG 行数，视为已补迁、跳过；可安全重跑。
 *
 * 用法（先停 kagami-server）：
 *   SOURCE_DATABASE_URL="postgres://..." pnpm --filter @kagami/server exec tsx scripts/migrate-pg-remaining-append.ts
 */
import pg from "pg";
import { loadStaticConfig } from "../src/config/config.loader.js";
import { createDbClient, closeDb } from "../src/db/client.js";
import * as Prisma from "../src/generated/prisma/internal/prismaNamespace.js";

/** Json 列：null/undefined 用 Prisma.DbNull 表示 SQL NULL，否则原样传对象。 */
function j(value: unknown): unknown {
  return value === null || value === undefined ? Prisma.DbNull : value;
}

type Delegate = {
  count: () => Promise<number>;
  createMany: (a: { data: unknown[] }) => Promise<unknown>;
};

type Spec = {
  table: string;
  batch: number;
  delegate: Delegate;
  map: (row: Record<string, unknown>) => Record<string, unknown>;
};

async function main(): Promise<void> {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("缺少环境变量 SOURCE_DATABASE_URL（旧 PostgreSQL 连接串）");
  }

  const config = await loadStaticConfig();
  const pgClient = new pg.Client({ connectionString: sourceUrl });
  await pgClient.connect();
  const database = createDbClient({ databaseUrl: config.server.databaseUrl });

  const specs: Spec[] = [
    {
      table: "app_log",
      batch: 500,
      delegate: database.appLog,
      map: r => ({
        traceId: r.trace_id,
        level: r.level,
        message: r.message,
        metadata: j(r.metadata),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "llm_chat_call",
      batch: 50,
      delegate: database.llmChatCall,
      map: r => ({
        requestId: r.request_id,
        seq: r.seq,
        provider: r.provider,
        model: r.model,
        extension: j(r.extension),
        status: r.status,
        requestPayload: j(r.request_payload),
        responsePayload: j(r.response_payload),
        nativeRequestPayload: j(r.native_request_payload),
        nativeResponsePayload: j(r.native_response_payload),
        error: j(r.error),
        nativeError: j(r.native_error),
        latencyMs: r.latency_ms,
        createdAt: r.created_at,
      }),
    },
    {
      table: "metric",
      batch: 500,
      delegate: database.metric,
      map: r => ({
        metricName: r.metric_name,
        value: r.value,
        tags: j(r.tags),
        occurredAt: r.occurred_at,
        createdAt: r.created_at,
      }),
    },
    {
      table: "napcat_event",
      batch: 500,
      delegate: database.napcatEvent,
      map: r => ({
        postType: r.post_type,
        messageType: r.message_type,
        subType: r.sub_type,
        userId: r.user_id,
        groupId: r.group_id,
        eventTime: r.event_time,
        payload: j(r.payload),
        createdAt: r.created_at,
      }),
    },
    {
      table: "napcat_qq_message",
      batch: 300,
      delegate: database.napcatQqMessage,
      map: r => ({
        messageType: r.message_type,
        subType: r.sub_type,
        groupId: r.group_id,
        userId: r.user_id,
        nickname: r.nickname,
        messageId: r.message_id,
        message: j(r.message),
        eventTime: r.event_time,
        payload: j(r.payload),
        createdAt: r.created_at,
      }),
    },
    {
      table: "auth_usage_snapshot",
      batch: 500,
      delegate: database.authUsageSnapshot,
      map: r => ({
        provider: r.provider,
        accountId: r.account_id,
        windowKey: r.window_key,
        remainingPercent: r.remaining_percent,
        resetAt: r.reset_at,
        capturedAt: r.captured_at,
      }),
    },
    {
      table: "oauth_state",
      batch: 500,
      delegate: database.oauthState,
      map: r => ({
        state: r.state,
        codeVerifier: r.code_verifier,
        redirectUri: r.redirect_uri,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        createdAt: r.created_at,
      }),
    },
    {
      table: "terminal_output",
      batch: 500,
      delegate: database.terminalOutput,
      map: r => ({
        outputId: r.output_id,
        stdout: r.stdout,
        stderr: r.stderr,
        createdAt: r.created_at,
      }),
    },
  ];

  console.log("追加补迁 8 张瞬时表（分页流式、幂等、不清空、不指定 id）...\n");
  try {
    for (const spec of specs) {
      await appendTable(pgClient, spec);
    }
  } finally {
    await pgClient.end();
    await closeDb(database);
  }
  console.log("\n补迁完成。");
}

async function appendTable(pgClient: pg.Client, spec: Spec): Promise<void> {
  const pgCount = Number(
    (await pgClient.query(`SELECT count(*)::int AS n FROM "${spec.table}"`)).rows[0].n,
  );
  const before = await spec.delegate.count();
  if (before >= pgCount) {
    console.log(`  ${spec.table}: 已补迁（SQLite ${before} >= PG ${pgCount}），跳过`);
    return;
  }

  let lastId = 0;
  let appended = 0;
  for (;;) {
    const page = await pgClient.query(
      `SELECT * FROM "${spec.table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [lastId, spec.batch],
    );
    if (page.rows.length === 0) {
      break;
    }
    await spec.delegate.createMany({ data: page.rows.map(spec.map) });
    lastId = Number(page.rows[page.rows.length - 1].id);
    appended += page.rows.length;
  }

  console.log(
    `  ${spec.table}: 追加 ${appended} 行（PG ${pgCount}），SQLite ${before} → ${await spec.delegate.count()}`,
  );
}

main().catch((error: unknown) => {
  console.error("补迁失败：", error);
  process.exitCode = 1;
});
