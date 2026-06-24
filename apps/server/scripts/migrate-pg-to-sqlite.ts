/**
 * 一次性数据搬迁：旧 PostgreSQL → 新 SQLite（停机迁移）。
 *
 * 用法（先停服务）：
 *   SOURCE_DATABASE_URL="postgres://user:pass@localhost:5432/kagami" \
 *     pnpm --filter @kagami/server exec tsx scripts/migrate-pg-to-sqlite.ts
 *
 * - 源库（PG）连接串来自环境变量 SOURCE_DATABASE_URL（必填）。
 * - 目标库（SQLite）来自 config.yaml 的 server.databaseUrl（已切换为 file:）。
 * - 只搬迁关键有状态数据；日志 / 指标 / 事件等瞬时表不迁移。
 * - 目标表会先清空再导入，可重复执行。
 * - 写入统一走 Prisma Client，保证 DateTime / JSON 的存储格式与运行时读取一致。
 * - story_memory_document 的 pgvector 向量以 `embedding::text` 取出后转存 JSON 字符串；
 *   首次启动时 HNSW 索引会从这些行重建。
 */
import pg from "pg";
import { loadStaticConfig } from "../src/config/config.loader.js";
import { createDbClient, closeDb } from "../src/db/client.js";

const BATCH_SIZE = 500;

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
  console.log("开始搬迁（目标表会先清空）...\n");

  try {
    // 顺序遵循外键依赖：story 先于 story_memory_document。
    await copyTable(pgClient, {
      label: "story",
      sourceSql: `SELECT id, markdown, source_message_seq_start, source_message_seq_end, created_at, updated_at FROM "story"`,
      delegate: database.story,
      mapRow: row => ({
        id: row.id,
        markdown: row.markdown,
        sourceMessageSeqStart: row.source_message_seq_start,
        sourceMessageSeqEnd: row.source_message_seq_end,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "story_memory_document",
      sourceSql: `SELECT id, story_id, kind, content, embedding_model, embedding_dim, embedding::text AS embedding_text, created_at, updated_at FROM "story_memory_document"`,
      delegate: database.storyMemoryDocument,
      mapRow: row => ({
        id: row.id,
        storyId: row.story_id,
        kind: row.kind,
        content: row.content,
        embeddingModel: row.embedding_model,
        embeddingDim: row.embedding_dim,
        embedding: normalizeVectorLiteral(row.embedding_text),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "ledger",
      sourceSql: `SELECT id, runtime_key, message, created_at FROM "ledger"`,
      delegate: database.linearMessageLedger,
      mapRow: row => ({
        id: row.id,
        runtimeKey: row.runtime_key,
        message: row.message,
        createdAt: row.created_at,
      }),
    });

    await copyTable(pgClient, {
      label: "oauth_session",
      sourceSql: `SELECT * FROM "oauth_session"`,
      delegate: database.oauthSession,
      mapRow: row => ({
        id: row.id,
        provider: row.provider,
        accountId: row.account_id,
        email: row.email,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        idToken: row.id_token,
        expiresAt: row.expires_at,
        lastRefreshAt: row.last_refresh_at,
        status: row.status,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "root_agent_runtime_snapshot",
      sourceSql: `SELECT * FROM "root_agent_runtime_snapshot"`,
      delegate: database.rootAgentRuntimeSnapshot,
      mapRow: row => ({
        id: row.id,
        runtimeKey: row.runtime_key,
        schemaVersion: row.schema_version,
        contextSnapshot: row.context_snapshot,
        sessionSnapshot: row.session_snapshot,
        lastWakeReminderAt: row.last_wake_reminder_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "story_agent_runtime_snapshot",
      sourceSql: `SELECT * FROM "story_agent_runtime_snapshot"`,
      delegate: database.storyAgentRuntimeSnapshot,
      mapRow: row => ({
        id: row.id,
        runtimeKey: row.runtime_key,
        schemaVersion: row.schema_version,
        contextSnapshot: row.context_snapshot,
        lastProcessedMessageSeq: row.last_processed_message_seq,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "news_article",
      sourceSql: `SELECT * FROM "news_article"`,
      delegate: database.newsArticle,
      mapRow: row => ({
        id: row.id,
        sourceKey: row.source_key,
        upstreamId: row.upstream_id,
        title: row.title,
        url: row.url,
        publishedAt: row.published_at,
        rssSummary: row.rss_summary,
        rssPayload: row.rss_payload,
        articleContent: row.article_content,
        articleContentStatus: row.article_content_status,
        articleContentFetchedAt: row.article_content_fetched_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "news_feed_cursor",
      sourceSql: `SELECT * FROM "news_feed_cursor"`,
      delegate: database.newsFeedCursor,
      mapRow: row => ({
        sourceKey: row.source_key,
        lastSeenArticleId: row.last_seen_article_id,
        lastSeenPublishedAt: row.last_seen_published_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "embedding_cache",
      sourceSql: `SELECT * FROM "embedding_cache"`,
      delegate: database.embeddingCache,
      mapRow: row => ({
        id: row.id,
        provider: row.provider,
        model: row.model,
        taskType: row.task_type,
        outputDimensionality: row.output_dimensionality,
        text: row.text,
        textHash: row.text_hash,
        // PG 的 Float[] 由 node-postgres 解析为数组，转存为 JSON 字符串。
        embedding: JSON.stringify(row.embedding ?? []),
        createdAt: row.created_at,
      }),
    });

    await copyTable(pgClient, {
      label: "metric_chart",
      sourceSql: `SELECT * FROM "metric_chart"`,
      delegate: database.metricChart,
      mapRow: row => ({
        id: row.id,
        chartName: row.chart_name,
        metricName: row.metric_name,
        aggregator: row.aggregator,
        tagFilters: row.tag_filters,
        groupByTag: row.group_by_tag,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    await copyTable(pgClient, {
      label: "terminal_state",
      sourceSql: `SELECT * FROM "terminal_state"`,
      delegate: database.terminalState,
      mapRow: row => ({
        id: row.id,
        cwd: row.cwd,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });

    console.log("\n搬迁完成。首次启动时 HNSW 向量索引会从 story_memory_document 自动重建。");
  } finally {
    await pgClient.end();
    await closeDb(database);
  }
}

type CopyTableOptions = {
  label: string;
  sourceSql: string;
  delegate: {
    deleteMany: (args?: unknown) => Promise<unknown>;
    createMany: (args: { data: unknown[] }) => Promise<unknown>;
  };
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>;
};

async function copyTable(pgClient: pg.Client, options: CopyTableOptions): Promise<void> {
  let rows: Record<string, unknown>[];
  try {
    const result = await pgClient.query(options.sourceSql);
    rows = result.rows;
  } catch (error) {
    console.warn(`  ${options.label}: 跳过（源表读取失败：${(error as Error).message}）`);
    return;
  }

  await options.delegate.deleteMany({});

  const mapped = rows.map(options.mapRow);
  for (let offset = 0; offset < mapped.length; offset += BATCH_SIZE) {
    await options.delegate.createMany({ data: mapped.slice(offset, offset + BATCH_SIZE) });
  }
  console.log(`  ${options.label}: ${mapped.length} 行`);
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
