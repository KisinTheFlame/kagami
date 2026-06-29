import * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import { toInputJsonObject } from "../../common/prisma-json.js";
import type { Database } from "../../db/client.js";
import type {
  InsertMetricInput,
  MetricChartSeriesRow,
  MetricDao,
  QueryMetricChartSeriesInput,
} from "../metric.dao.js";

type PrismaMetricDaoDeps = {
  database: Database;
};

export class PrismaMetricDao implements MetricDao {
  private readonly database: Database;

  public constructor({ database }: PrismaMetricDaoDeps) {
    this.database = database;
  }

  public async insert(input: InsertMetricInput): Promise<void> {
    await this.database.metric.create({
      data: {
        metricName: input.metricName,
        value: input.value,
        tags: toInputJsonObject(input.tags),
        occurredAt: input.occurredAt,
      },
    });
  }

  public async queryChartSeries(
    input: QueryMetricChartSeriesInput,
  ): Promise<MetricChartSeriesRow[]> {
    const bucketSeconds = bucketToSeconds(input.bucket);
    const seriesKeyExpression = input.groupByTag
      ? Prisma.sql`NULLIF("tags" ->> ${input.groupByTag}, '')`
      : Prisma.sql`NULL`;
    // SQLite 下 DateTime 以 ISO-8601 文本存储，unixepoch 解析为 epoch 秒。绑定参数会以 REAL
    // 传入导致 `/` 走浮点除法（不截断），故用 CAST(... AS INTEGER) 强制整除再乘回，实现分桶。
    const bucketExpression = Prisma.sql`CAST(unixepoch("occurred_at") / ${bucketSeconds} AS INTEGER) * ${bucketSeconds}`;
    const whereClause = buildChartSeriesWhereClause(input);

    const rows =
      input.aggregator === "last"
        ? await this.queryLastValueSeries({ bucketExpression, seriesKeyExpression, whereClause })
        : await this.queryAggregatedSeries({
            bucketExpression,
            seriesKeyExpression,
            whereClause,
            aggregateExpression: buildAggregateExpression(input.aggregator),
          });

    return rows.map(row => ({
      bucketStart: new Date(Number(row.bucketStart) * 1000),
      seriesKey: row.seriesKey,
      value: row.value === null ? null : Number(row.value),
    }));
  }

  private async queryAggregatedSeries(input: {
    bucketExpression: Prisma.Sql;
    seriesKeyExpression: Prisma.Sql;
    whereClause: Prisma.Sql;
    aggregateExpression: Prisma.Sql;
  }): Promise<RawMetricChartSeriesRow[]> {
    // SQLite ORDER BY ASC 默认把 NULL 排在最前，无需 PG 的 NULLS FIRST。
    return this.database.$queryRaw<RawMetricChartSeriesRow[]>(Prisma.sql`
      WITH filtered_metrics AS (
        SELECT
          ${input.bucketExpression} AS "bucketStart",
          ${input.seriesKeyExpression} AS "seriesKey",
          "value" AS "value"
        FROM "metric"
        ${input.whereClause}
      )
      SELECT
        "bucketStart" AS "bucketStart",
        "seriesKey" AS "seriesKey",
        ${input.aggregateExpression} AS "value"
      FROM filtered_metrics
      GROUP BY "bucketStart", "seriesKey"
      ORDER BY "bucketStart" ASC, "seriesKey" ASC
    `);
  }

  private async queryLastValueSeries(input: {
    bucketExpression: Prisma.Sql;
    seriesKeyExpression: Prisma.Sql;
    whereClause: Prisma.Sql;
  }): Promise<RawMetricChartSeriesRow[]> {
    // PG 的 ARRAY_AGG(... ORDER BY ...)[1] 在 SQLite 无对应，用窗口函数取每个桶内最新一条。
    return this.database.$queryRaw<RawMetricChartSeriesRow[]>(Prisma.sql`
      SELECT "bucketStart" AS "bucketStart", "seriesKey" AS "seriesKey", "value" AS "value"
      FROM (
        SELECT
          ${input.bucketExpression} AS "bucketStart",
          ${input.seriesKeyExpression} AS "seriesKey",
          "value" AS "value",
          ROW_NUMBER() OVER (
            PARTITION BY ${input.bucketExpression}, ${input.seriesKeyExpression}
            ORDER BY "occurred_at" DESC, "id" DESC
          ) AS "rowNumber"
        FROM "metric"
        ${input.whereClause}
      )
      WHERE "rowNumber" = 1
      ORDER BY "bucketStart" ASC, "seriesKey" ASC
    `);
  }
}

type RawMetricChartSeriesRow = {
  // SQLite 返回的 bucketStart 是 epoch 秒（整数），value 是聚合数值；统一在映射处转换。
  bucketStart: number | bigint | string;
  seriesKey: string | null;
  value: number | bigint | string | null;
};

function buildChartSeriesWhereClause(input: QueryMetricChartSeriesInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"metric_name" = ${input.metricName}`,
    Prisma.sql`"occurred_at" >= ${input.startAt}`,
    Prisma.sql`"occurred_at" <= ${input.endAt}`,
  ];

  for (const [key, value] of Object.entries(input.tagFilters ?? {})) {
    conditions.push(Prisma.sql`"tags" ->> ${key} = ${value}`);
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function buildAggregateExpression(
  aggregator: Exclude<QueryMetricChartSeriesInput["aggregator"], "last">,
): Prisma.Sql {
  switch (aggregator) {
    case "count":
      return Prisma.sql`COUNT(*)`;
    case "sum":
      return Prisma.sql`SUM("value")`;
    case "avg":
      return Prisma.sql`AVG("value")`;
    case "max":
      return Prisma.sql`MAX("value")`;
    case "min":
      return Prisma.sql`MIN("value")`;
  }
}

function bucketToSeconds(bucket: QueryMetricChartSeriesInput["bucket"]): number {
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
