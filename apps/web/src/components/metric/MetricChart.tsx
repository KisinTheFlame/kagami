import {
  type MetricChartAggregator,
  type MetricChartBucket,
  type MetricChartQueryRequest,
  type MetricChartRangePreset,
  type MetricChartTagFilters,
} from "@kagami/metric-api/chart";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiErrorMessage } from "@/lib/api";
import { MetricChartView } from "./MetricChartView";
import { useMetricChartData } from "./useMetricChartData";

// === 组合层：拥有 range / bucket 控件 + 手动刷新，调 hook 取数、渲染 View（#444）===
//
// 这是**冻结的稳定边界**：日后往任意页面插图，只 import 本组件、传 props，无需碰后端 / 契约。
// 图表定义（metricName / aggregator / tagFilters / groupByTag）就近声明在使用处。

type MetricChartProps = {
  metricName: string;
  aggregator: MetricChartAggregator;
  title: string;
  /** 副标题；缺省时按 metric / 聚合 / 分组自动拼一句。 */
  subtitle?: string;
  tagFilters?: MetricChartTagFilters;
  groupByTag?: string;
  defaultRangePreset?: MetricChartRangePreset;
  /** 缺省按 range 自动选桶。 */
  defaultBucket?: MetricChartBucket;
  height?: number;
};

const rangePresetOptions = [
  "1m",
  "10m",
  "30m",
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "2d",
] as const satisfies readonly MetricChartRangePreset[];

const bucketOptions = [
  "10s",
  "1m",
  "5m",
  "30m",
  "1h",
] as const satisfies readonly MetricChartBucket[];

const defaultBucketByPreset: Record<MetricChartRangePreset, MetricChartBucket> = {
  "1m": "10s",
  "10m": "1m",
  "30m": "1m",
  "1h": "5m",
  "3h": "5m",
  "6h": "30m",
  "12h": "30m",
  "1d": "1h",
  "2d": "1h",
};

export function MetricChart({
  metricName,
  aggregator,
  title,
  subtitle,
  tagFilters,
  groupByTag,
  defaultRangePreset = "1h",
  defaultBucket,
  height,
}: MetricChartProps) {
  const [rangePreset, setRangePreset] = useState<MetricChartRangePreset>(defaultRangePreset);
  const [bucket, setBucket] = useState<MetricChartBucket>(
    defaultBucket ?? defaultBucketByPreset[defaultRangePreset],
  );
  const [bucketTouched, setBucketTouched] = useState(defaultBucket !== undefined);

  // 结构化 query key 天然对内联规格去重，无需 memo request 引用。
  const request: MetricChartQueryRequest = {
    metricName,
    aggregator,
    bucket,
    rangePreset,
    ...(groupByTag ? { groupByTag } : {}),
    ...(tagFilters ? { tagFilters } : {}),
  };

  const query = useMetricChartData(request);

  function handleSelectPreset(next: MetricChartRangePreset) {
    setRangePreset(next);
    if (!bucketTouched) {
      setBucket(defaultBucketByPreset[next]);
    }
  }

  function handleSelectBucket(next: MetricChartBucket) {
    setBucket(next);
    setBucketTouched(true);
  }

  const resolvedSubtitle =
    subtitle ??
    `metric: ${metricName} · 聚合 ${aggregator}${groupByTag ? ` · 按 ${groupByTag} 拆线` : ""}`;

  return (
    <MetricChartView
      title={title}
      subtitle={resolvedSubtitle}
      isLoading={query.isLoading}
      isError={query.isError}
      errorMessage={query.isError ? getApiErrorMessage(query.error) : undefined}
      data={query.data}
      height={height}
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={rangePreset}
            onValueChange={value => handleSelectPreset(value as MetricChartRangePreset)}
          >
            <SelectTrigger className="h-8 w-24 rounded-none text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rangePresetOptions.map(preset => (
                <SelectItem key={preset} value={preset}>
                  近 {preset}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={bucket}
            onValueChange={value => handleSelectBucket(value as MetricChartBucket)}
          >
            <SelectTrigger className="h-8 w-20 rounded-none text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bucketOptions.map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-none"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      }
    />
  );
}
