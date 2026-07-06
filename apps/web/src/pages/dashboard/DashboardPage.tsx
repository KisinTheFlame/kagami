import type { MetricChartBucket, MetricChartQueryRequest } from "@kagami/metric-api/chart";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { MetricChartView } from "@/components/metric/MetricChartView";
import { useMetricChartData } from "@/components/metric/useMetricChartData";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiErrorMessage } from "@/lib/api";
import { mergeToolSeries } from "./dashboard-series";

// === 大盘（#475 后续）===
//
// 首张图：Wait 工具 vs 所有工具的调用次数（面积图）。两条各自过滤的单序列查询共享同一显式 range +
// bucket（一次算好，避免两次 new Date() 桶轴错位），再叠成两序列。日后往这页加图即可。

const TOOL_CALL_METRIC = "agent.tool.call";
const WAIT_TOOL = "wait"; // WaitTool 的注册名（tool-call-metric 打点里 tags.tool 的取值）

type RangePreset = {
  key: string;
  label: string;
  rangeMs: number;
  bucket: MetricChartBucket;
};

const RANGE_PRESETS: readonly RangePreset[] = [
  { key: "1h", label: "近 1 小时", rangeMs: 60 * 60 * 1000, bucket: "5m" },
  { key: "6h", label: "近 6 小时", rangeMs: 6 * 60 * 60 * 1000, bucket: "30m" },
  { key: "1d", label: "近 1 天", rangeMs: 24 * 60 * 60 * 1000, bucket: "1h" },
];

const DEFAULT_PRESET = RANGE_PRESETS[1];

function computeRange(rangeMs: number): { startAt: string; endAt: string } {
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - rangeMs);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

export function DashboardPage() {
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET.key);
  const preset = RANGE_PRESETS.find(item => item.key === presetKey) ?? DEFAULT_PRESET;
  // range 只在初次 / 换 preset / 手动刷新时重算一次，两条查询共享，保证桶轴对齐、也避免每次渲染 refetch。
  const [range, setRange] = useState(() => computeRange(DEFAULT_PRESET.rangeMs));

  const allRequest: MetricChartQueryRequest = {
    metricName: TOOL_CALL_METRIC,
    aggregator: "count",
    bucket: preset.bucket,
    startAt: range.startAt,
    endAt: range.endAt,
  };
  const waitRequest: MetricChartQueryRequest = {
    ...allRequest,
    tagFilters: { tool: { op: "eq", value: WAIT_TOOL } },
  };

  const allQuery = useMetricChartData(allRequest);
  const waitQuery = useMetricChartData(waitRequest);

  const data = mergeToolSeries([
    { label: "所有工具", data: allQuery.data },
    { label: "Wait 工具", data: waitQuery.data },
  ]);

  const isLoading = allQuery.isLoading || waitQuery.isLoading;
  const isError = allQuery.isError || waitQuery.isError;
  const isFetching = allQuery.isFetching || waitQuery.isFetching;
  const errorMessage = allQuery.isError
    ? getApiErrorMessage(allQuery.error)
    : waitQuery.isError
      ? getApiErrorMessage(waitQuery.error)
      : undefined;

  function handleSelectPreset(nextKey: string) {
    const next = RANGE_PRESETS.find(item => item.key === nextKey) ?? DEFAULT_PRESET;
    setPresetKey(next.key);
    setRange(computeRange(next.rangeMs));
  }

  function handleRefresh() {
    setRange(computeRange(preset.rangeMs));
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-3 md:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">大盘</h1>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <MetricChartView
          title="工具使用次数"
          subtitle="Wait 工具 vs 所有工具的调用次数"
          chartType="area"
          isLoading={isLoading}
          isError={isError}
          errorMessage={errorMessage}
          data={data}
          height={360}
          headerRight={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={preset.key} onValueChange={handleSelectPreset}>
                <SelectTrigger className="h-8 w-28 rounded-none text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_PRESETS.map(item => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-none"
                onClick={handleRefresh}
                disabled={isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}
