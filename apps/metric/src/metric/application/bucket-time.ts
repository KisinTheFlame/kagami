import type { MetricChartBucket } from "@kagami/metric-api/chart";

// 桶时间轴共享助手：单指标查询（buildSeries 补空桶）与派生查询（对齐补 null）共用同一套桶对齐，
// 避免两处各写一份、漂移出不一致的桶边界。

export function bucketToMilliseconds(bucket: MetricChartBucket): number {
  switch (bucket) {
    case "10s":
      return 10 * 1000;
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
  }
}

/** 闭区间列出范围内每个桶的起点（含首尾对齐桶）；与 DAO 的 epoch 分桶同口径。 */
export function listBucketStarts(startAt: Date, endAt: Date, bucketMs: number): Date[] {
  const alignedStartAt = new Date(Math.floor(startAt.getTime() / bucketMs) * bucketMs);
  const alignedEndAt = new Date(Math.floor(endAt.getTime() / bucketMs) * bucketMs);
  const buckets: Date[] = [];

  for (
    let current = alignedStartAt.getTime();
    current <= alignedEndAt.getTime();
    current += bucketMs
  ) {
    buckets.push(new Date(current));
  }

  return buckets;
}
