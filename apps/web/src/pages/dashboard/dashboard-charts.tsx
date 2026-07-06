import type {
  MetricChartAggregator,
  MetricChartBucket,
  MetricChartQueryRequest,
  MetricChartTagFilters,
} from "@kagami/metric-api/chart";
import { MetricChartView, type MetricChartType } from "@/components/metric/MetricChartView";
import { useMetricChartData } from "@/components/metric/useMetricChartData";
import { getApiErrorMessage } from "@/lib/api";
import { mergeToolSeries } from "./dashboard-series";

// 大盘图组件：全都吃页面级共享的时间范围 + bucket（一次算好，所有图对齐、一起刷新），不再各自持控件。

export type DashboardRange = {
  startAt: string;
  endAt: string;
  bucket: MetricChartBucket;
};

function toRequest(
  spec: {
    metricName: string;
    aggregator: MetricChartAggregator;
    tagFilters?: MetricChartTagFilters;
    groupByTag?: string;
  },
  range: DashboardRange,
): MetricChartQueryRequest {
  return {
    metricName: spec.metricName,
    aggregator: spec.aggregator,
    bucket: range.bucket,
    startAt: range.startAt,
    endAt: range.endAt,
    ...(spec.tagFilters ? { tagFilters: spec.tagFilters } : {}),
    ...(spec.groupByTag ? { groupByTag: spec.groupByTag } : {}),
  };
}

const CHART_HEIGHT = 300;

type DashboardChartProps = {
  title: string;
  subtitle?: string;
  metricName: string;
  aggregator: MetricChartAggregator;
  chartType: MetricChartType;
  groupByTag?: string;
  tagFilters?: MetricChartTagFilters;
  range: DashboardRange;
};

/** 单条查询图：一次查询（可按某 tag 分组成多序列），交给 MetricChartView 按 chartType 画。 */
export function DashboardChart({
  title,
  subtitle,
  metricName,
  aggregator,
  chartType,
  groupByTag,
  tagFilters,
  range,
}: DashboardChartProps) {
  const query = useMetricChartData(
    toRequest({ metricName, aggregator, groupByTag, tagFilters }, range),
  );

  return (
    <MetricChartView
      title={title}
      subtitle={subtitle}
      chartType={chartType}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage={query.isError ? getApiErrorMessage(query.error) : undefined}
      data={query.data}
      height={CHART_HEIGHT}
    />
  );
}

type OverlaySpec = {
  label: string;
  metricName: string;
  aggregator: MetricChartAggregator;
  tagFilters?: MetricChartTagFilters;
};

type DashboardOverlayChartProps = {
  title: string;
  subtitle?: string;
  /** 全集序列（画在下层）。 */
  total: OverlaySpec;
  /** 子集序列（画在上层，看占比）。 */
  subset: OverlaySpec;
  range: DashboardRange;
};

/** 双查询叠放面积图：两条各自过滤的单序列查询共享同一 range，叠成「子集 vs 全集」（如缓存命中 vs 总输入）。 */
export function DashboardOverlayChart({
  title,
  subtitle,
  total,
  subset,
  range,
}: DashboardOverlayChartProps) {
  const totalQuery = useMetricChartData(toRequest(total, range));
  const subsetQuery = useMetricChartData(toRequest(subset, range));

  // total 先（下层）、subset 后（上层）；MetricChartView 后渲染者在上，子集叠在全集上看占比。
  const data = mergeToolSeries([
    { label: total.label, data: totalQuery.data },
    { label: subset.label, data: subsetQuery.data },
  ]);

  const isError = totalQuery.isError || subsetQuery.isError;

  return (
    <MetricChartView
      title={title}
      subtitle={subtitle}
      chartType="area"
      isLoading={totalQuery.isLoading || subsetQuery.isLoading}
      isError={isError}
      errorMessage={
        totalQuery.isError
          ? getApiErrorMessage(totalQuery.error)
          : subsetQuery.isError
            ? getApiErrorMessage(subsetQuery.error)
            : undefined
      }
      data={data}
      height={CHART_HEIGHT}
    />
  );
}
