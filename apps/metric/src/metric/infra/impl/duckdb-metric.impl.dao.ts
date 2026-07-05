import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBPreparedStatement,
} from "@duckdb/node-api";
import type {
  InsertMetricInput,
  MetricChartAggregator,
  MetricChartSeriesRow,
  MetricDao,
  QueryMetricChartSeriesInput,
} from "../metric.dao.js";

/**
 * DuckDB 版 metric 数据层（#475 P1）。metric 从共享 SQLite / Prisma 迁出，落 kagami-metric 独占的
 * 单个 DuckDB 文件——列式引擎为「扫大表、按维度聚合」而生，原生 `quantile_cont`（p95，为 P2 铺路）、
 * 高基数 top-N 可 `QUALIFY` 下推，消灭 SQLite 行存 + JSON 抽取在分析聚合上的短板（见观察台 #371）。
 *
 * P1 只做「行为等价」：输出的 MetricChartSeriesRow 与旧 PrismaMetricDao 一致，service 层的
 * buildSeries / resolveTimeRange 全不动。所有用户输入走 DuckDB 预处理语句参数绑定，SQL 只内联
 * 受信枚举（bucket 秒数、聚合函数名）。
 */

/** 打开（或新建）metric DuckDB 库并建表，返回 DAO。传 `:memory:` 用内存库（测试用）。 */
export async function openMetricDuckDb(dbPath: string): Promise<DuckDbMetricDao> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  // 自增 id 做 `last` 聚合桶内同刻的稳定 tiebreak（对齐旧 SQLite 的 autoincrement 语义）。
  await connection.run(`CREATE SEQUENCE IF NOT EXISTS metric_id_seq START 1`);
  await connection.run(`
    CREATE TABLE IF NOT EXISTS metric (
      id BIGINT PRIMARY KEY DEFAULT nextval('metric_id_seq'),
      metric_name VARCHAR NOT NULL,
      value DOUBLE NOT NULL,
      tags JSON NOT NULL,
      occurred_at TIMESTAMP NOT NULL DEFAULT current_timestamp
    )
  `);
  return new DuckDbMetricDao({ instance, connection });
}

type DuckDbMetricDaoDeps = {
  instance: DuckDBInstance;
  connection: DuckDBConnection;
};

export class DuckDbMetricDao implements MetricDao {
  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;

  public constructor({ instance, connection }: DuckDbMetricDaoDeps) {
    this.instance = instance;
    this.connection = connection;
  }

  public async insert(input: InsertMetricInput): Promise<void> {
    const tagsJson = JSON.stringify(input.tags);
    if (input.occurredAt) {
      const prepared = await this.connection.prepare(
        `INSERT INTO metric (metric_name, value, tags, occurred_at)
         VALUES ($1, $2, $3::JSON, $4::TIMESTAMP)`,
      );
      prepared.bindVarchar(1, input.metricName);
      prepared.bindDouble(2, input.value);
      prepared.bindVarchar(3, tagsJson);
      prepared.bindVarchar(4, toDuckDbTimestamp(input.occurredAt));
      await prepared.run();
      return;
    }
    // 未给 occurredAt：落库时刻由列默认 current_timestamp 兜底（对齐旧 Prisma @default(now())）。
    const prepared = await this.connection.prepare(
      `INSERT INTO metric (metric_name, value, tags) VALUES ($1, $2, $3::JSON)`,
    );
    prepared.bindVarchar(1, input.metricName);
    prepared.bindDouble(2, input.value);
    prepared.bindVarchar(3, tagsJson);
    await prepared.run();
  }

  public async queryChartSeries(
    input: QueryMetricChartSeriesInput,
  ): Promise<MetricChartSeriesRow[]> {
    const params = new VarcharParams();
    const bucketSeconds = bucketToSeconds(input.bucket);
    // epoch(occurred_at) 得 UTC 秒；整除（//）对齐桶再乘回 = 桶起点 epoch 秒（与旧 SQLite 输出等价）。
    const bucketExpression = `(CAST(epoch("occurred_at") AS BIGINT) // ${bucketSeconds}) * ${bucketSeconds}`;
    const seriesKeyExpression = input.groupByTag
      ? `NULLIF("tags" ->> ${params.add(input.groupByTag)}, '')`
      : `NULL`;
    const whereClause = buildWhereClause(input, params);

    const sql =
      input.aggregator === "last"
        ? `
      SELECT "bucketStart", "seriesKey", "value" FROM (
        SELECT
          ${bucketExpression} AS "bucketStart",
          ${seriesKeyExpression} AS "seriesKey",
          "value" AS "value",
          row_number() OVER (
            PARTITION BY ${bucketExpression}, ${seriesKeyExpression}
            ORDER BY "occurred_at" DESC, "id" DESC
          ) AS rn
        FROM "metric"
        ${whereClause}
      )
      WHERE rn = 1
      ORDER BY "bucketStart" ASC, "seriesKey" ASC NULLS FIRST
    `
        : `
      WITH filtered AS (
        SELECT
          ${bucketExpression} AS "bucketStart",
          ${seriesKeyExpression} AS "seriesKey",
          "value" AS "value"
        FROM "metric"
        ${whereClause}
      )
      SELECT
        "bucketStart" AS "bucketStart",
        "seriesKey" AS "seriesKey",
        ${buildAggregateExpression(input.aggregator)} AS "value"
      FROM filtered
      GROUP BY "bucketStart", "seriesKey"
      ORDER BY "bucketStart" ASC, "seriesKey" ASC NULLS FIRST
    `;

    const prepared = await this.connection.prepare(sql);
    params.bindAll(prepared);
    const reader = await prepared.runAndReadAll();
    const rows = reader.getRowObjects() as RawMetricChartSeriesRow[];

    return rows.map(row => ({
      bucketStart: new Date(Number(row.bucketStart) * 1000),
      seriesKey: row.seriesKey === null ? null : String(row.seriesKey),
      value: row.value === null ? null : Number(row.value),
    }));
  }

  public close(): void {
    this.connection.closeSync();
    this.instance.closeSync();
  }
}

type RawMetricChartSeriesRow = {
  // DuckDB 返回 bucketStart（epoch 秒）与 count 为 bigint，value（sum/avg 等）为 number；映射处统一转。
  bucketStart: number | bigint;
  seriesKey: string | null;
  value: number | bigint | null;
};

/** 顺序累加 varchar 参数，返回 `$n` 占位符；同一 `$n` 可在 SQL 里被多处引用、只绑一次。 */
class VarcharParams {
  private readonly values: string[] = [];

  public add(value: string): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  public bindAll(prepared: DuckDBPreparedStatement): void {
    this.values.forEach((value, index) => prepared.bindVarchar(index + 1, value));
  }
}

function buildWhereClause(input: QueryMetricChartSeriesInput, params: VarcharParams): string {
  const conditions = [
    `"metric_name" = ${params.add(input.metricName)}`,
    `"occurred_at" >= ${params.add(toDuckDbTimestamp(input.startAt))}::TIMESTAMP`,
    `"occurred_at" <= ${params.add(toDuckDbTimestamp(input.endAt))}::TIMESTAMP`,
  ];

  for (const [key, value] of Object.entries(input.tagFilters ?? {})) {
    // 括号必需：DuckDB `->>` 优先级低于 `=`，不加括号会被解析成 `tags ->> (key = value)`。
    conditions.push(`("tags" ->> ${params.add(key)}) = ${params.add(value)}`);
  }

  return `WHERE ${conditions.join(" AND ")}`;
}

function buildAggregateExpression(aggregator: Exclude<MetricChartAggregator, "last">): string {
  switch (aggregator) {
    case "count":
      return `COUNT(*)`;
    case "sum":
      return `SUM("value")`;
    case "avg":
      return `AVG("value")`;
    case "max":
      return `MAX("value")`;
    case "min":
      return `MIN("value")`;
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

/** Date → DuckDB TIMESTAMP 可解析的裸 UTC 文本（去掉 ISO 的 `T`/`Z`，naive 时间戳按 UTC 解释）。 */
function toDuckDbTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
