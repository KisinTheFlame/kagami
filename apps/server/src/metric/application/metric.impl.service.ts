import { z } from "zod";
import { AppLogger } from "../../logger/logger.js";
import { BizError } from "../../common/errors/biz-error.js";
import type { MetricTags } from "../domain/metric.js";
import type { MetricDao } from "../infra/metric.dao.js";
import type { MetricService, RecordMetricInput } from "./metric.service.js";

type DefaultMetricServiceDeps = {
  metricDao: MetricDao;
};

const logger = new AppLogger({ source: "metric.service" });

const RecordMetricInputSchema = z.object({
  metricName: z.string().trim().min(1),
  value: z.number().finite(),
  tags: z.record(z.string(), z.string()).optional(),
  occurredAt: z.date().optional(),
});

export class DefaultMetricService implements MetricService {
  private readonly metricDao: MetricDao;

  public constructor({ metricDao }: DefaultMetricServiceDeps) {
    this.metricDao = metricDao;
  }

  public async record(input: RecordMetricInput): Promise<void> {
    const normalized = parseRecordMetricInput(input);

    try {
      await this.metricDao.insert(normalized);
    } catch (error) {
      logger.errorWithCause("Failed to persist metric record", error, {
        event: "metric.record.persist_failed",
        metricName: normalized.metricName,
        value: normalized.value,
        tags: normalized.tags,
        occurredAt: normalized.occurredAt?.toISOString(),
      });
    }
  }
}

function parseRecordMetricInput(input: RecordMetricInput): {
  metricName: string;
  value: number;
  tags: MetricTags;
  occurredAt?: Date;
} {
  const parsed = RecordMetricInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BizError({
      message: "Metric 打点参数不合法",
      meta: {
        reason: "METRIC_RECORD_INVALID",
        issues: parsed.error.issues,
      },
      statusCode: 400,
    });
  }

  return {
    metricName: parsed.data.metricName,
    value: parsed.data.value,
    tags: normalizeTags(parsed.data.tags),
    occurredAt: parsed.data.occurredAt,
  };
}

function normalizeTags(input: MetricTags | undefined): MetricTags {
  if (!input) {
    return {};
  }

  const normalized: MetricTags = {};

  for (const [rawKey, value] of Object.entries(input)) {
    const key = rawKey.trim();
    if (key.length === 0) {
      throw new BizError({
        message: "Metric 打点参数不合法",
        meta: {
          reason: "METRIC_RECORD_INVALID",
          issues: [
            {
              path: ["tags"],
              message: "Metric tag key 不能为空白字符串",
            },
          ],
        },
        statusCode: 400,
      });
    }

    normalized[key] = value;
  }

  return normalized;
}
