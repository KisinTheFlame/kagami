import type * as Prisma from "@kagami/persistence/prisma";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { Database } from "@kagami/persistence/db/client";
import type { MetricChartDao } from "../metric-chart.dao.js";
import {
  METRIC_CHART_AGGREGATORS,
  type CreateMetricChartInput,
  type MetricChartAggregator,
  type MetricChartItem,
} from "../../domain/metric.js";

const logger = new AppLogger({ source: "prisma-metric-chart-dao" });

// aggregator 是 DB 出参的 enum 字段，校验失败时降级用的兜底值。
// console 是只读查询页后端，单条脏数据不应让整页抛 500。
const DEFAULT_AGGREGATOR: MetricChartAggregator = "sum";

function toMetricChartAggregator(value: string): MetricChartAggregator {
  if ((METRIC_CHART_AGGREGATORS as readonly string[]).includes(value)) {
    return value as MetricChartAggregator;
  }

  logger.warn("Unexpected metric chart aggregator from db, falling back to default", {
    event: "metric_chart_dao.invalid_aggregator",
    value,
    fallback: DEFAULT_AGGREGATOR,
  });

  return DEFAULT_AGGREGATOR;
}

type PrismaMetricChartDaoDeps = {
  database: Database;
};

export class PrismaMetricChartDao implements MetricChartDao {
  private readonly database: Database;

  public constructor({ database }: PrismaMetricChartDaoDeps) {
    this.database = database;
  }

  public async create(input: CreateMetricChartInput): Promise<MetricChartItem> {
    const row = await this.database.metricChart.create({
      data: {
        chartName: input.chartName,
        metricName: input.metricName,
        aggregator: input.aggregator,
        tagFilters: input.tagFilters ? toInputJsonObject(input.tagFilters) : undefined,
        groupByTag: input.groupByTag ?? null,
      },
    });

    return mapMetricChartRow(row);
  }

  public async findByChartName(chartName: string): Promise<MetricChartItem | null> {
    const row = await this.database.metricChart.findUnique({
      where: {
        chartName,
      },
    });

    return row ? mapMetricChartRow(row) : null;
  }

  public async deleteByChartName(chartName: string): Promise<boolean> {
    const result = await this.database.metricChart.deleteMany({
      where: {
        chartName,
      },
    });

    return result.count > 0;
  }

  public async list(): Promise<MetricChartItem[]> {
    const rows = await this.database.metricChart.findMany({
      orderBy: [{ chartName: "asc" }, { id: "asc" }],
    });

    return rows.map(mapMetricChartRow);
  }
}

function mapMetricChartRow(row: {
  id: number;
  chartName: string;
  metricName: string;
  aggregator: string;
  tagFilters: unknown;
  groupByTag: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MetricChartItem {
  return {
    id: row.id,
    chartName: row.chartName,
    metricName: row.metricName,
    aggregator: toMetricChartAggregator(row.aggregator),
    tagFilters: toMetricTags(row.tagFilters),
    groupByTag: row.groupByTag,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMetricTags(value: unknown): MetricChartItem["tagFilters"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const tags = Object.entries(value).reduce<Record<string, string>>((result, [key, current]) => {
    result[key] = String(current);
    return result;
  }, {});

  return tags;
}

function toInputJsonObject(tags: Record<string, string>): Prisma.InputJsonObject {
  return tags as Prisma.InputJsonObject;
}
