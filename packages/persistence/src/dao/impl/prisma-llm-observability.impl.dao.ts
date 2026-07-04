import * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../db/client.js";
import type {
  LlmModelCount,
  LlmObservabilityDao,
  LlmObservabilityFilters,
  LlmObservabilityGroupBy,
  LlmObservabilityRange,
  LlmOverviewStats,
  LlmTimeseriesRow,
  QueryLlmTimeseriesInput,
} from "../llm-observability.dao.js";

type PrismaLlmObservabilityDaoDeps = {
  database: Database;
};

// SQLite 数值经 $queryRaw 回来可能是 number / bigint / string，统一在映射处 Number() 收口。
type RawScalar = number | bigint | string | null;

type RawOverviewRow = {
  totalCalls: RawScalar;
  errorCount: RawScalar;
  latencyAvgMs: RawScalar;
  promptTokens: RawScalar;
  completionTokens: RawScalar;
  totalTokens: RawScalar;
  cacheHitTokens: RawScalar;
  cacheMissTokens: RawScalar;
};

type RawP95Row = { p95: RawScalar };

type RawModelRow = { provider: string; model: string; count: RawScalar };

type RawTimeseriesRow = {
  bucketStart: RawScalar;
  seriesKey: string | null;
  value: RawScalar;
};

/**
 * LLM 观察台聚合的 Prisma 实现。全部只读 raw SQL，绝不 SELECT payload 整列——只取标量列 +
 * `json_extract(response_payload, '$.usage.*')`。查询一律按 `created_at` 范围收窄，命中
 * `llm_chat_call_created_at_idx`；token 五字段镜像 response_payload.usage 的归一化形状。
 */
export class PrismaLlmObservabilityDao implements LlmObservabilityDao {
  private readonly database: Database;

  public constructor({ database }: PrismaLlmObservabilityDaoDeps) {
    this.database = database;
  }

  public async overviewStats(range: LlmObservabilityRange): Promise<LlmOverviewStats> {
    const where = rangeWhere(range);

    // token 提取用 json_valid 兜底：response_payload 正常是 Prisma 写入的合法 JSON，但一条
    // 迁移遗留 / 人工改库的坏 JSON 会让 json_extract abort 整条 query（→ overview 500）。
    // 坏行按 0 计入，不拖垮整页。
    const [statsRow] = await this.database.$queryRaw<RawOverviewRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS "totalCalls",
        COALESCE(SUM(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END), 0) AS "errorCount",
        AVG("latency_ms") AS "latencyAvgMs",
        COALESCE(SUM(${usageTokenExpression("promptTokens")}), 0) AS "promptTokens",
        COALESCE(SUM(${usageTokenExpression("completionTokens")}), 0) AS "completionTokens",
        COALESCE(SUM(${usageTokenExpression("totalTokens")}), 0) AS "totalTokens",
        COALESCE(SUM(${usageTokenExpression("cacheHitTokens")}), 0) AS "cacheHitTokens",
        COALESCE(SUM(${usageTokenExpression("cacheMissTokens")}), 0) AS "cacheMissTokens"
      FROM "llm_chat_call"
      ${where}
    `);

    // p95 单列另算，用与分桶 p95（queryP95Series）**同一套 nearest-rank 公式**（rn >= 0.95*cnt
    // 取 MIN），保证同页「概览 p95 卡」与「延迟时序 p95 线」小样本下数字一致。无非空 latency →
    // 子查询无行 → MIN 为 NULL → null。单样本 rn=1 >= 0.95 命中自身。
    const latencyWhere = Prisma.sql`${where} AND "latency_ms" IS NOT NULL`;
    const [p95Row] = await this.database.$queryRaw<RawP95Row[]>(Prisma.sql`
      SELECT MIN("latency_ms") AS "p95"
      FROM (
        SELECT
          "latency_ms" AS "latency_ms",
          ROW_NUMBER() OVER (ORDER BY "latency_ms") AS "rn",
          COUNT(*) OVER () AS "cnt"
        FROM "llm_chat_call"
        ${latencyWhere}
      )
      WHERE "rn" >= 0.95 * "cnt"
    `);

    return {
      totalCalls: toNumber(statsRow?.totalCalls) ?? 0,
      errorCount: toNumber(statsRow?.errorCount) ?? 0,
      latencyAvgMs: toNumber(statsRow?.latencyAvgMs),
      latencyP95Ms: toNumber(p95Row?.p95),
      promptTokens: toNumber(statsRow?.promptTokens) ?? 0,
      completionTokens: toNumber(statsRow?.completionTokens) ?? 0,
      totalTokens: toNumber(statsRow?.totalTokens) ?? 0,
      cacheHitTokens: toNumber(statsRow?.cacheHitTokens) ?? 0,
      cacheMissTokens: toNumber(statsRow?.cacheMissTokens) ?? 0,
    };
  }

  public async modelBreakdown(range: LlmObservabilityRange): Promise<LlmModelCount[]> {
    const rows = await this.database.$queryRaw<RawModelRow[]>(Prisma.sql`
      SELECT "provider" AS "provider", "model" AS "model", COUNT(*) AS "count"
      FROM "llm_chat_call"
      ${rangeWhere(range)}
      GROUP BY "provider", "model"
      ORDER BY "count" DESC, "provider" ASC, "model" ASC
    `);

    return rows.map(row => ({
      provider: row.provider,
      model: row.model,
      count: toNumber(row.count) ?? 0,
    }));
  }

  public async timeseries(input: QueryLlmTimeseriesInput): Promise<LlmTimeseriesRow[]> {
    const bucketSeconds = bucketToSeconds(input.bucket);
    const bucketExpression = Prisma.sql`CAST(unixepoch("created_at") / ${bucketSeconds} AS INTEGER) * ${bucketSeconds}`;
    const seriesKeyExpression = groupByExpression(input.groupBy);
    const where = buildWhere(input.range, input.filters);

    const rows =
      input.metric === "latencyP95"
        ? await this.queryP95Series({ where, bucketExpression, seriesKeyExpression })
        : await this.queryAggregatedSeries({
            where,
            bucketExpression,
            seriesKeyExpression,
            valueExpression: aggregateExpression(input.metric),
          });

    return rows.map(row => ({
      bucketStart: new Date(Number(row.bucketStart) * 1000),
      seriesKey: row.seriesKey,
      value: toNumber(row.value),
    }));
  }

  private async queryAggregatedSeries(input: {
    where: Prisma.Sql;
    bucketExpression: Prisma.Sql;
    seriesKeyExpression: Prisma.Sql;
    valueExpression: Prisma.Sql;
  }): Promise<RawTimeseriesRow[]> {
    // SQLite ORDER BY ASC 默认 NULL 在前，无需 PG 的 NULLS FIRST。
    return this.database.$queryRaw<RawTimeseriesRow[]>(Prisma.sql`
      WITH filtered AS (
        SELECT
          ${input.bucketExpression} AS "bucketStart",
          ${input.seriesKeyExpression} AS "seriesKey",
          "latency_ms" AS "latencyMs",
          "status" AS "status"
        FROM "llm_chat_call"
        ${input.where}
      )
      SELECT "bucketStart" AS "bucketStart", "seriesKey" AS "seriesKey", ${input.valueExpression} AS "value"
      FROM filtered
      GROUP BY "bucketStart", "seriesKey"
      ORDER BY "bucketStart" ASC, "seriesKey" ASC
    `);
  }

  private async queryP95Series(input: {
    where: Prisma.Sql;
    bucketExpression: Prisma.Sql;
    seriesKeyExpression: Prisma.Sql;
  }): Promise<RawTimeseriesRow[]> {
    // 分桶 p95：nearest-rank。ROW_NUMBER 分区内 1-based 排名，COUNT 分区样本数，取
    // rn >= 0.95*cnt 的最小 latency。单样本桶（cnt=1）rn=1 >= 0.95 命中自身——比旧的
    // PERCENT_RANK>=0.95 好，后者单样本恒 0 会漏掉低流量桶的 p95。
    return this.database.$queryRaw<RawTimeseriesRow[]>(Prisma.sql`
      WITH filtered AS (
        SELECT
          ${input.bucketExpression} AS "bucketStart",
          ${input.seriesKeyExpression} AS "seriesKey",
          "latency_ms" AS "latencyMs",
          ROW_NUMBER() OVER (
            PARTITION BY ${input.bucketExpression}, ${input.seriesKeyExpression}
            ORDER BY "latency_ms"
          ) AS "rn",
          COUNT(*) OVER (
            PARTITION BY ${input.bucketExpression}, ${input.seriesKeyExpression}
          ) AS "cnt"
        FROM "llm_chat_call"
        ${input.where} AND "latency_ms" IS NOT NULL
      )
      SELECT "bucketStart" AS "bucketStart", "seriesKey" AS "seriesKey", MIN("latencyMs") AS "value"
      FROM filtered
      WHERE "rn" >= 0.95 * "cnt"
      GROUP BY "bucketStart", "seriesKey"
      ORDER BY "bucketStart" ASC, "seriesKey" ASC
    `);
  }
}

function rangeWhere(range: LlmObservabilityRange): Prisma.Sql {
  return buildWhere(range, undefined);
}

// token 提取：json_valid 兜底坏 JSON（否则 json_extract abort 整条 query）；CAST AS INTEGER
// 收口非整数 payload（某 provider 若写入字符串/浮点 token），避免聚合出非整数在契约
// output.parse(z.int()) 处 500。字段名来自本文件调用点（非用户输入），path 仍走绑定参数。
function usageTokenExpression(field: string): Prisma.Sql {
  return Prisma.sql`CASE WHEN json_valid("response_payload") THEN CAST(json_extract("response_payload", ${`$.usage.${field}`}) AS INTEGER) END`;
}

// 统一 WHERE 构造：时间窗恒有，provider/model/status 过滤按需追加（均为一等列，命中索引/直接扫）。
function buildWhere(
  range: LlmObservabilityRange,
  filters: LlmObservabilityFilters | undefined,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"created_at" >= ${range.from}`,
    Prisma.sql`"created_at" <= ${range.to}`,
  ];
  if (filters?.provider) {
    conditions.push(Prisma.sql`"provider" = ${filters.provider}`);
  }
  if (filters?.model) {
    conditions.push(Prisma.sql`"model" = ${filters.model}`);
  }
  if (filters?.status) {
    conditions.push(Prisma.sql`"status" = ${filters.status}`);
  }
  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function groupByExpression(groupBy: LlmObservabilityGroupBy | undefined): Prisma.Sql {
  switch (groupBy) {
    case "provider":
      return Prisma.sql`"provider"`;
    case "model":
      return Prisma.sql`"model"`;
    case "status":
      return Prisma.sql`"status"`;
    case undefined:
      return Prisma.sql`NULL`;
  }
}

function aggregateExpression(
  metric: Exclude<QueryLlmTimeseriesInput["metric"], "latencyP95">,
): Prisma.Sql {
  switch (metric) {
    case "calls":
      return Prisma.sql`COUNT(*)`;
    case "errors":
      return Prisma.sql`COALESCE(SUM(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END), 0)`;
    case "latencyAvg":
      return Prisma.sql`AVG("latencyMs")`;
  }
}

function bucketToSeconds(bucket: QueryLlmTimeseriesInput["bucket"]): number {
  switch (bucket) {
    case "10s":
      return 10;
    case "1m":
      return 60;
    case "5m":
      return 5 * 60;
    case "30m":
      return 30 * 60;
    case "1h":
      return 60 * 60;
  }
}

function toNumber(value: RawScalar | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}
