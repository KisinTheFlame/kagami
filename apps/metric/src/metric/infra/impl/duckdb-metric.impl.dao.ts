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
  MetricDeriveOperand,
  MetricDerivedSeriesRow,
  MetricTagFilters,
  QueryDerivedSeriesInput,
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
      occurred_at TIMESTAMP NOT NULL
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
    // occurredAt 缺省时用当前 UTC 时刻兜底，绝不落到列的 DB 默认：DuckDB `current_timestamp`
    // 按会话时区把 naive 墙钟写入 TIMESTAMP，`epoch()` 便带上机器 UTC 偏移，非 UTC 部署机上整条
    // 时间轴静默错位（生产上报方普遍不传 occurredAt）。统一走 toDuckDbTimestamp(UTC ISO) 保证等价。
    const occurredAt = toDuckDbTimestamp(input.occurredAt ?? new Date());
    const prepared = await this.connection.prepare(
      `INSERT INTO metric (metric_name, value, tags, occurred_at)
       VALUES ($1, $2, $3::JSON, $4::TIMESTAMP)`,
    );
    prepared.bindVarchar(1, input.metricName);
    prepared.bindDouble(2, input.value);
    prepared.bindVarchar(3, tagsJson);
    prepared.bindVarchar(4, occurredAt);
    await prepared.run();
  }

  public async queryChartSeries(
    input: QueryMetricChartSeriesInput,
  ): Promise<MetricChartSeriesRow[]> {
    const params = new VarcharParams();
    const bucketSeconds = bucketToSeconds(input.bucket);
    const bucketExpression = bucketStartExpression(bucketSeconds);
    const seriesKeyExpression = input.groupByTag
      ? `NULLIF("tags" ->> ${params.add(input.groupByTag)}, '')`
      : `NULL`;
    const whereClause = buildWhereClause(input, params);

    // 每桶每序列压成一行 (bucketStart, seriesKey, value)。last 走 row_number 取桶内最新，
    // 其余（含百分位）走 GROUP BY 聚合。
    const bucketedCte =
      input.aggregator === "last"
        ? `
      bucketed AS (
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
      )`
        : `
      filtered AS (
        SELECT
          ${bucketExpression} AS "bucketStart",
          ${seriesKeyExpression} AS "seriesKey",
          "value" AS "value"
        FROM "metric"
        ${whereClause}
      ),
      bucketed AS (
        SELECT
          "bucketStart" AS "bucketStart",
          "seriesKey" AS "seriesKey",
          ${buildAggregateExpression(input.aggregator)} AS "value"
        FROM filtered
        GROUP BY "bucketStart", "seriesKey"
      )`;

    const orderBy = `ORDER BY "bucketStart" ASC, "seriesKey" ASC NULLS FIRST`;

    // 分组查询时把 series top-N 下推 SQL：按各 series「绝对量之和」排名，只留前 MAX_SERIES 条，
    // DB 不物化高基数 groupByTag 的全量 series（#444 defer 的 DoS，本阶段修）。ORDER 带 seriesKey
    // tiebreak 保证确定性。IS NOT DISTINCT FROM 让「未命中」的 NULL series 也参与排名、不被 JOIN 丢。
    const sql = input.groupByTag
      ? `
      WITH ${bucketedCte},
      series_rank AS (
        SELECT
          "seriesKey",
          -- tiebreak 显式 NULLS FIRST：magnitude 打平时让「未分组」的 NULL series 排在前、优先保留
          -- （对齐旧 service 端 stable sort + DAO NULLS FIRST 输出的语义，避免边界处静默丢它）。
          row_number() OVER (
            ORDER BY SUM(ABS("value")) DESC NULLS LAST, "seriesKey" ASC NULLS FIRST
          ) AS srn
        FROM bucketed
        GROUP BY "seriesKey"
      )
      SELECT b."bucketStart", b."seriesKey", b."value"
      FROM bucketed b
      JOIN series_rank s ON b."seriesKey" IS NOT DISTINCT FROM s."seriesKey"
      WHERE s.srn <= ${MAX_SERIES}
      ${orderBy}
    `
      : `
      WITH ${bucketedCte}
      SELECT "bucketStart", "seriesKey", "value"
      FROM bucketed
      ${orderBy}
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

  public async queryDerivedSeries(
    input: QueryDerivedSeriesInput,
  ): Promise<MetricDerivedSeriesRow[]> {
    const params = new VarcharParams();
    const bucketSeconds = bucketToSeconds(input.bucket);
    const range = { startAt: input.startAt, endAt: input.endAt };
    // 分子/分母各自压成「每桶一个标量」的 CTE（无分组、无 top-N）。
    const numeratorCte = buildOperandCte("num", input.numerator, range, bucketSeconds, params);
    const denominatorCte = buildOperandCte("den", input.denominator, range, bucketSeconds, params);

    // 缺桶 / 除零语义在这一条表达式里定死：ratio 用 NULLIF 挡除零，diff 直接相减；两者都靠 SQL 的
    // NULL 传播——任一侧该桶无数据（FULL OUTER JOIN 补 NULL）时结果即 NULL，前端断线不臆造 0。
    const valueExpression =
      input.op === "ratio" ? `num."value" / NULLIF(den."value", 0)` : `num."value" - den."value"`;

    const sql = `
      WITH ${numeratorCte},
      ${denominatorCte}
      SELECT
        COALESCE(num."bucketStart", den."bucketStart") AS "bucketStart",
        ${valueExpression} AS "value"
      FROM num
      FULL OUTER JOIN den ON num."bucketStart" = den."bucketStart"
      ORDER BY "bucketStart" ASC
    `;

    const prepared = await this.connection.prepare(sql);
    params.bindAll(prepared);
    const reader = await prepared.runAndReadAll();
    const rows = reader.getRowObjects() as RawMetricDerivedSeriesRow[];

    return rows.map(row => ({
      bucketStart: new Date(Number(row.bucketStart) * 1000),
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

type RawMetricDerivedSeriesRow = {
  bucketStart: number | bigint;
  value: number | bigint | null;
};

/**
 * 桶起点 epoch 秒表达式。epoch(occurred_at) 得 UTC 秒（DOUBLE，带亚秒小数）；先 floor 截断到整秒
 * ——对齐旧 SQLite unixepoch 的截断语义，而非 DuckDB `CAST(DOUBLE AS BIGINT)` 的四舍五入（.5xx 秒
 * 会被顶进下一个桶）。再整除（//）对齐桶乘回。
 */
function bucketStartExpression(bucketSeconds: number): string {
  return `(CAST(floor(epoch("occurred_at")) AS BIGINT) // ${bucketSeconds}) * ${bucketSeconds}`;
}

/** 派生查询的单个操作数 → 「每桶一个标量值」的具名 CTE（无分组、无 top-N）。 */
function buildOperandCte(
  name: string,
  operand: MetricDeriveOperand,
  range: { startAt: Date; endAt: Date },
  bucketSeconds: number,
  params: VarcharParams,
): string {
  const bucketExpression = bucketStartExpression(bucketSeconds);
  const whereClause = buildWhereClause(
    {
      metricName: operand.metricName,
      startAt: range.startAt,
      endAt: range.endAt,
      tagFilters: operand.tagFilters,
    },
    params,
  );

  if (operand.aggregator === "last") {
    return `${name} AS (
      SELECT "bucketStart", "value" FROM (
        SELECT
          ${bucketExpression} AS "bucketStart",
          "value" AS "value",
          row_number() OVER (
            PARTITION BY ${bucketExpression}
            ORDER BY "occurred_at" DESC, "id" DESC
          ) AS rn
        FROM "metric"
        ${whereClause}
      )
      WHERE rn = 1
    )`;
  }

  return `${name} AS (
    SELECT
      ${bucketExpression} AS "bucketStart",
      ${buildAggregateExpression(operand.aggregator)} AS "value"
    FROM "metric"
    ${whereClause}
    GROUP BY "bucketStart"
  )`;
}

/** 分组查询最多返回的 series 数：SQL 层按总量取前 N、其余丢弃，防高基数 groupByTag 撑爆响应。 */
const MAX_SERIES = 20;

/** 顺序累加 varchar 参数，返回 `$n` 占位符；同一 `$n` 可在 SQL 里被多处引用、只绑一次。 */
class VarcharParams {
  private readonly values: string[] = [];

  public add(value: string): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** 绑一组值，返回逗号分隔的 `$a, $b, ...`（供 `IN (...)` 用）。 */
  public addList(values: readonly string[]): string {
    return values.map(value => this.add(value)).join(", ");
  }

  public bindAll(prepared: DuckDBPreparedStatement): void {
    this.values.forEach((value, index) => prepared.bindVarchar(index + 1, value));
  }
}

/** buildWhereClause 只需这几项：单查询与派生查询的操作数都套得上。 */
type MetricWhereInput = {
  metricName: string;
  startAt: Date;
  endAt: Date;
  tagFilters: MetricTagFilters | null;
};

function buildWhereClause(input: MetricWhereInput, params: VarcharParams): string {
  const conditions = [
    `"metric_name" = ${params.add(input.metricName)}`,
    `"occurred_at" >= ${params.add(toDuckDbTimestamp(input.startAt))}::TIMESTAMP`,
    `"occurred_at" <= ${params.add(toDuckDbTimestamp(input.endAt))}::TIMESTAMP`,
  ];

  for (const [key, filter] of Object.entries(input.tagFilters ?? {})) {
    // 空 in 列表 = 空集恒不命中 → 直接 FALSE，避免生成非法的 `IN ()`。wire schema 的 min(1) 已挡
    // HTTP 入口，此为 DAO 层对未来非 HTTP caller 的防御。放在最前，避免为它多绑一个不出现在 SQL
    // 的 key 占位符（会让 DuckDB 参数编号错位）。
    if (filter.op === "in" && filter.value.length === 0) {
      conditions.push(`FALSE`);
      continue;
    }
    // 括号必需：DuckDB `->>` 优先级低于比较运算，不加括号会被解析成 `tags ->> (key <op> value)`。
    const extracted = `("tags" ->> ${params.add(key)})`;
    switch (filter.op) {
      case "eq":
        conditions.push(`${extracted} = ${params.add(filter.value)}`);
        break;
      case "ne":
        // 补集语义：值不等于 target 即命中，含 tag 缺失（NULL）的行。IS DISTINCT FROM 把 NULL 当可比。
        conditions.push(`${extracted} IS DISTINCT FROM ${params.add(filter.value)}`);
        break;
      case "in":
        conditions.push(`${extracted} IN (${params.addList(filter.value)})`);
        break;
    }
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
    // 百分位从桶内原始样本连续插值现算（不可从已聚合值再聚合）。
    case "p50":
      return `quantile_cont("value", 0.5)`;
    case "p95":
      return `quantile_cont("value", 0.95)`;
    case "p99":
      return `quantile_cont("value", 0.99)`;
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
