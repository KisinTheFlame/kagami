import type { MetricChartQueryResponse } from "@kagami/metric-api/chart";

// 大盘把「两条各自过滤的单序列查询」（Wait 工具计数 / 所有工具计数）叠成一张两序列图。两条查询共享
// 同一显式 range + bucket，故桶轴一致；某条无数据时沿另一条的桶轴补 0（大盘只用 count，缺桶即 0）。

export type ToolSeriesInput = {
  label: string;
  data: MetricChartQueryResponse | undefined;
};

export function mergeToolSeries(inputs: ToolSeriesInput[]): MetricChartQueryResponse | undefined {
  const withData = inputs.find(input => (input.data?.series.length ?? 0) > 0)?.data;
  if (!withData) {
    // 两条都无数据 → 交给 MetricChartView 出「没有数据」占位。
    return undefined;
  }

  const axis = withData.series[0]?.points.map(point => point.bucketStart) ?? [];

  return {
    bucket: withData.bucket,
    startAt: withData.startAt,
    endAt: withData.endAt,
    series: inputs.map((input, index) => ({
      key: `s${index}`,
      label: input.label,
      points: input.data?.series[0]?.points ?? axis.map(bucketStart => ({ bucketStart, value: 0 })),
    })),
  };
}
