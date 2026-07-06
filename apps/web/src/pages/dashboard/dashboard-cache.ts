import type { MetricChartQueryResponse } from "@kagami/metric-api/chart";
import { formatBucketLabel } from "@/components/metric/metric-format";

// 缓存图把「总输入 token（绝对量）」与「缓存命中率（派生比率）」两条各自查询按桶对齐成一行行，供双 Y
// 轴 composed 图用：左轴画 token 面积、右轴画命中率 %。两条查询共享同一 range/bucket，桶轴一致。

export type CacheRow = {
  bucketStart: string;
  label: string;
  /** 总输入 token（左轴，面积）。 */
  tokens: number | null;
  /** 缓存命中率 %（右轴，线）；派生比率 0-1 × 100，缺桶 / 除零为 null。 */
  ratePct: number | null;
};

export function buildCacheRows(
  total: MetricChartQueryResponse | undefined,
  rate: MetricChartQueryResponse | undefined,
): CacheRow[] {
  const totalPoints = total?.series[0]?.points ?? [];
  const rateByBucket = new Map<string, number | null>();
  for (const point of rate?.series[0]?.points ?? []) {
    rateByBucket.set(point.bucketStart, point.value);
  }

  return totalPoints.map(point => {
    const ratio = rateByBucket.get(point.bucketStart);
    return {
      bucketStart: point.bucketStart,
      label: formatBucketLabel(point.bucketStart),
      tokens: point.value,
      ratePct: ratio === undefined || ratio === null ? null : ratio * 100,
    };
  });
}
