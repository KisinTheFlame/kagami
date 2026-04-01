import * as Prisma from "../../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../../db/client.js";
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
    const aggregateExpression = buildAggregateExpression(input.aggregator);
    const whereClause = buildChartSeriesWhereClause(input);

    const rows = await this.database.$queryRaw<RawMetricChartSeriesRow[]>(Prisma.sql`
      WITH filtered_metrics AS (
        SELECT
          to_timestamp(
            FLOOR(EXTRACT(EPOCH FROM "occurred_at") / ${bucketSeconds}) * ${bucketSeconds}
          ) AS "bucketStart",
          ${seriesKeyExpression} AS "seriesKey",
          "value" AS "value",
          "occurred_at" AS "occurredAt"
        FROM "metric"
        ${whereClause}
      )
      SELECT
        "bucketStart" AS "bucketStart",
        "seriesKey" AS "seriesKey",
        ${aggregateExpression} AS "value"
      FROM filtered_metrics
      GROUP BY "bucketStart", "seriesKey"
      ORDER BY "bucketStart" ASC, "seriesKey" ASC NULLS FIRST
    `);

    return rows.map(row => ({
      bucketStart: row.bucketStart,
      seriesKey: row.seriesKey,
      value: row.value,
    }));
  }
}

function toInputJsonObject(tags: Record<string, string>): Prisma.InputJsonObject {
  return tags as Prisma.InputJsonObject;
}

type RawMetricChartSeriesRow = {
  bucketStart: Date;
  seriesKey: string | null;
  value: number | null;
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
  aggregator: QueryMetricChartSeriesInput["aggregator"],
): Prisma.Sql {
  switch (aggregator) {
    case "count":
      return Prisma.sql`COUNT(*)::double precision`;
    case "sum":
      return Prisma.sql`SUM("value")::double precision`;
    case "avg":
      return Prisma.sql`AVG("value")::double precision`;
    case "max":
      return Prisma.sql`MAX("value")::double precision`;
    case "min":
      return Prisma.sql`MIN("value")::double precision`;
    case "last":
      return Prisma.sql`(ARRAY_AGG("value" ORDER BY "occurredAt" DESC))[1]::double precision`;
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
