import { BizError } from "@kagami/kernel/errors/biz-error";
import type { RecordMetricRequest } from "@kagami/metric-api/record";
import type { MetricDao } from "../infra/metric.dao.js";
import type { MetricTags } from "../domain/metric.js";
import type { MetricRecordService } from "./metric-record.service.js";

type DefaultMetricRecordServiceDeps = {
  metricDao: MetricDao;
};

/**
 * metric 摄取用例：zod 已在路由层校验值形状，这里只做 record schema 表达不出的规则
 * （tag key 去空白后不能为空）+ 把 ISO occurredAt 解析为 Date，然后落库。
 * 写入失败照常抛（→ 500）；上报方是 fire-and-forget 客户端，会自行吞掉。
 */
export class DefaultMetricRecordService implements MetricRecordService {
  private readonly metricDao: MetricDao;

  public constructor({ metricDao }: DefaultMetricRecordServiceDeps) {
    this.metricDao = metricDao;
  }

  public async record(input: RecordMetricRequest): Promise<void> {
    await this.metricDao.insert({
      metricName: input.metricName,
      value: input.value,
      tags: normalizeTags(input.tags),
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
    });
  }
}

function normalizeTags(input: Record<string, string> | undefined): MetricTags {
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
