/**
 * 一次性数据搬迁：旧 PostgreSQL → 新 SQLite（停机迁移，全量覆盖所有表）。
 *
 * 用法（先停服务）：
 *   SOURCE_DATABASE_URL="postgres://user:pass@localhost:5432/kagami" \
 *     pnpm --filter @kagami/server exec tsx scripts/migrate-pg-to-sqlite.ts
 *
 * - 源库（PG）连接串来自环境变量 SOURCE_DATABASE_URL（必填）。
 * - 目标库（SQLite）来自 config.yaml 的 server.databaseUrl（已切换为 file:）。
 * - **全量迁移 schema 里的所有表**（含日志 / 指标 / 群消息历史 / LLM 历史 / 事件等）。
 * - 每张目标表先清空再导入，可重复执行；保留原始 id（与 PG 一一对应的镜像）。
 * - 写入统一走 Prisma Client，保证 DateTime / JSON 的存储格式与运行时读取一致。
 * - 大表（含大 JSON payload，如 llm_chat_call）按 id 分页流式读 PG，避免一次性整表读进内存 OOM。
 * - story_memory_document 的 pgvector 向量以 `embedding::text` 取出后转存 JSON 字符串；
 *   embedding_cache 的 Float[] 同样转 JSON 字符串。首次启动时 HNSW 索引会从行内向量重建。
 *
 * 注意：本脚本会**清空目标表**，仅用于「空库 / 全量重灌」的停机迁移。若目标 SQLite 已在
 * 生产运行、只想补迁个别表，请用 migrate-pg-remaining-append.ts（追加、不清空）。
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
  deleteMany: (args?: unknown) => Promise<unknown>;
  createMany: (a: { data: unknown[] }) => Promise<unknown>;
};

type Spec = {
  table: string;
  /** SELECT 的列；默认 `*`。pgvector 等需要显式 `::text` 的列在此自定义。 */
  columns?: string;
  /** 是否按整型 id 分页（默认 true）。string 主键的小表（story / news_feed_cursor）置 false。 */
  paginate?: boolean;
  batch?: number;
  delegate: Delegate;
  map: (row: Record<string, unknown>) => Record<string, unknown>;
};

async function main(): Promise<void> {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("缺少环境变量 SOURCE_DATABASE_URL（旧 PostgreSQL 连接串）");
  }

  const config = await loadStaticConfig();
  const targetUrl = config.server.databaseUrl;
  if (!targetUrl.startsWith("file:")) {
    throw new Error(`目标 databaseUrl 不是 SQLite file: 路径：${targetUrl}`);
  }

  const pgClient = new pg.Client({ connectionString: sourceUrl });
  await pgClient.connect();
  const database = createDbClient({ databaseUrl: targetUrl });

  console.log(`源库: ${sourceUrl}`);
  console.log(`目标: ${targetUrl}`);
  console.log("开始全量搬迁（目标表会先清空）...\n");

  // story 必须先于 story_memory_document（外键）。
  const specs: Spec[] = [
    {
      table: "story",
      paginate: false,
      delegate: database.story,
      map: r => ({
        id: r.id,
        markdown: r.markdown,
        sourceMessageSeqStart: r.source_message_seq_start,
        sourceMessageSeqEnd: r.source_message_seq_end,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "story_memory_document",
      columns: `id, story_id, kind, content, embedding_model, embedding_dim, embedding::text AS embedding_text, created_at, updated_at`,
      delegate: database.storyMemoryDocument,
      map: r => ({
        id: r.id,
        storyId: r.story_id,
        kind: r.kind,
        content: r.content,
        embeddingModel: r.embedding_model,
        embeddingDim: r.embedding_dim,
        embedding: normalizeVectorLiteral(r.embedding_text as string | null),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "ledger",
      delegate: database.linearMessageLedger,
      map: r => ({
        id: r.id,
        runtimeKey: r.runtime_key,
        message: j(r.message),
        createdAt: r.created_at,
      }),
    },
    {
      table: "oauth_session",
      delegate: database.oauthSession,
      map: r => ({
        id: r.id,
        provider: r.provider,
        accountId: r.account_id,
        email: r.email,
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        idToken: r.id_token,
        expiresAt: r.expires_at,
        lastRefreshAt: r.last_refresh_at,
        status: r.status,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "root_agent_runtime_snapshot",
      delegate: database.rootAgentRuntimeSnapshot,
      map: r => ({
        id: r.id,
        runtimeKey: r.runtime_key,
        schemaVersion: r.schema_version,
        contextSnapshot: j(r.context_snapshot),
        sessionSnapshot: j(r.session_snapshot),
        lastWakeReminderAt: r.last_wake_reminder_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "story_agent_runtime_snapshot",
      delegate: database.storyAgentRuntimeSnapshot,
      map: r => ({
        id: r.id,
        runtimeKey: r.runtime_key,
        schemaVersion: r.schema_version,
        contextSnapshot: j(r.context_snapshot),
        lastProcessedMessageSeq: r.last_processed_message_seq,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "news_article",
      delegate: database.newsArticle,
      map: r => ({
        id: r.id,
        sourceKey: r.source_key,
        upstreamId: r.upstream_id,
        title: r.title,
        url: r.url,
        publishedAt: r.published_at,
        rssSummary: r.rss_summary,
        rssPayload: j(r.rss_payload),
        articleContent: r.article_content,
        articleContentStatus: r.article_content_status,
        articleContentFetchedAt: r.article_content_fetched_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "news_feed_cursor",
      paginate: false,
      delegate: database.newsFeedCursor,
      map: r => ({
        sourceKey: r.source_key,
        lastSeenArticleId: r.last_seen_article_id,
        lastSeenPublishedAt: r.last_seen_published_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "embedding_cache",
      delegate: database.embeddingCache,
      map: r => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        taskType: r.task_type,
        outputDimensionality: r.output_dimensionality,
        text: r.text,
        textHash: r.text_hash,
        // PG 的 Float[] 由 node-postgres 解析为数组，转存为 JSON 字符串。
        embedding: JSON.stringify(r.embedding ?? []),
        createdAt: r.created_at,
      }),
    },
    {
      table: "metric_chart",
      delegate: database.metricChart,
      map: r => ({
        id: r.id,
        chartName: r.chart_name,
        metricName: r.metric_name,
        aggregator: r.aggregator,
        tagFilters: j(r.tag_filters),
        groupByTag: r.group_by_tag,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "terminal_state",
      delegate: database.terminalState,
      map: r => ({
        id: r.id,
        cwd: r.cwd,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    },
    {
      table: "app_log",
      delegate: database.appLog,
      map: r => ({
        id: r.id,
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
        id: r.id,
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
      delegate: database.metric,
      map: r => ({
        id: r.id,
        metricName: r.metric_name,
        value: r.value,
        tags: j(r.tags),
        occurredAt: r.occurred_at,
        createdAt: r.created_at,
      }),
    },
    {
      table: "napcat_event",
      batch: 300,
      delegate: database.napcatEvent,
      map: r => ({
        id: r.id,
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
        id: r.id,
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
      delegate: database.authUsageSnapshot,
      map: r => ({
        id: r.id,
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
      delegate: database.oauthState,
      map: r => ({
        id: r.id,
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
      delegate: database.terminalOutput,
      map: r => ({
        id: r.id,
        outputId: r.output_id,
        stdout: r.stdout,
        stderr: r.stderr,
        createdAt: r.created_at,
      }),
    },
  ];

  try {
    for (const spec of specs) {
      await copyTable(pgClient, spec);
    }
    console.log("\n搬迁完成。首次启动时 HNSW 向量索引会从 story_memory_document 自动重建。");
  } finally {
    await pgClient.end();
    await closeDb(database);
  }
}

async function copyTable(pgClient: pg.Client, spec: Spec): Promise<void> {
  const columns = spec.columns ?? "*";
  const batch = spec.batch ?? 500;

  let total = 0;
  try {
    await spec.delegate.deleteMany({});

    if (spec.paginate === false) {
      const result = await pgClient.query(`SELECT ${columns} FROM "${spec.table}"`);
      const rows = result.rows.map(spec.map);
      for (let offset = 0; offset < rows.length; offset += batch) {
        await spec.delegate.createMany({ data: rows.slice(offset, offset + batch) });
      }
      total = rows.length;
    } else {
      let lastId = 0;
      for (;;) {
        const page = await pgClient.query(
          `SELECT ${columns} FROM "${spec.table}" WHERE id > $1 ORDER BY id ASC LIMIT $2`,
          [lastId, batch],
        );
        if (page.rows.length === 0) {
          break;
        }
        await spec.delegate.createMany({ data: page.rows.map(spec.map) });
        lastId = Number(page.rows[page.rows.length - 1].id);
        total += page.rows.length;
      }
    }
  } catch (error) {
    console.warn(`  ${spec.table}: 跳过（${(error as Error).message}）`);
    return;
  }
  console.log(`  ${spec.table}: ${total} 行`);
}

/** pgvector `::text` 形如 `[1,2,3]`，规范化为紧凑 JSON 字符串；null 透传。 */
function normalizeVectorLiteral(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? JSON.stringify(parsed.map(item => Number(item))) : null;
}

main().catch((error: unknown) => {
  console.error("搬迁失败：", error);
  process.exitCode = 1;
});
