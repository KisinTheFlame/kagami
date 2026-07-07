import { type MetricChartBucket, METRIC_CHART_MAX_POINTS } from "@kagami/metric-api/chart";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardCacheChart } from "./DashboardCacheChart";
import { DashboardChart, DashboardOverlayChart, type DashboardRange } from "./dashboard-charts";
import { stateSeriesMeta } from "@/components/metric/state-meta";

// === 大盘 ===
//
// 一个页面级共享的时间范围 + bucket，一栅格多图（工具使用 + LLM 调用量/延迟/token）。所有图对齐同一
// range、一起刷新。查询定义就近声明在这里；图组件只吃 spec + range，不各自持控件。

const TOOL_CALL = "agent.tool.call";
const LLM_CALL = "llm.call";
const LLM_LATENCY = "llm.call.latency";
const LLM_TOKENS = "llm.call.tokens";
const MODEL_TAG = "model";
// 状态心跳采样（sampling profiler）：每点 value=1，tags.state = 当前状态桶（app/wait/portal）。
const STATE_SAMPLE = "agent.state.sample";
const STATE_TAG = "state";

// 延迟图只算成功调用：失败（尤其超时，latency=整个超时时长）会污染 avg/P99 读数。
const SUCCESS_ONLY = { status: { op: "eq" as const, value: "success" } };

type RangePreset = {
  key: string;
  label: string;
  rangeMs: number;
  /** 该 range 下的默认桶（换 range 时重置到这个，保证总在合法点数内）。 */
  bucket: MetricChartBucket;
};

const RANGE_PRESETS: readonly RangePreset[] = [
  { key: "1h", label: "近 1 小时", rangeMs: 60 * 60 * 1000, bucket: "5m" },
  { key: "6h", label: "近 6 小时", rangeMs: 6 * 60 * 60 * 1000, bucket: "30m" },
  { key: "1d", label: "近 1 天", rangeMs: 24 * 60 * 60 * 1000, bucket: "1h" },
];

const DEFAULT_PRESET = RANGE_PRESETS[1];

const BUCKET_OPTIONS: readonly { key: MetricChartBucket; label: string; ms: number }[] = [
  { key: "10s", label: "10 秒", ms: 10 * 1000 },
  { key: "1m", label: "1 分钟", ms: 60 * 1000 },
  { key: "5m", label: "5 分钟", ms: 5 * 60 * 1000 },
  { key: "30m", label: "30 分钟", ms: 30 * 60 * 1000 },
  { key: "1h", label: "1 小时", ms: 60 * 60 * 1000 },
];

type TimeWindow = { startAt: string; endAt: string };

function computeWindow(preset: RangePreset): TimeWindow {
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - preset.rangeMs);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

export function DashboardPage() {
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET.key);
  const preset = RANGE_PRESETS.find(item => item.key === presetKey) ?? DEFAULT_PRESET;
  // 时间窗 + 桶都只在初次 / 换 range / 换桶 / 刷新时变一次，所有图共享 → 桶轴对齐、也避免每次渲染 refetch。
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(() => computeWindow(DEFAULT_PRESET));
  const [bucket, setBucket] = useState<MetricChartBucket>(DEFAULT_PRESET.bucket);

  // 只提供在当前 range 下点数不超上限的桶（大 range + 小桶会被后端 2000 点 guard 拒）。
  const bucketOptions = useMemo(
    () =>
      BUCKET_OPTIONS.filter(
        option => Math.floor(preset.rangeMs / option.ms) + 1 <= METRIC_CHART_MAX_POINTS,
      ),
    [preset.rangeMs],
  );

  const range: DashboardRange = { ...timeWindow, bucket };

  function handleSelectPreset(nextKey: string) {
    const next = RANGE_PRESETS.find(item => item.key === nextKey) ?? DEFAULT_PRESET;
    setPresetKey(next.key);
    setTimeWindow(computeWindow(next));
    // 换 range 时把桶重置成该 range 的默认桶（总在合法点数内），避免残留一个对新 range 越界的桶。
    setBucket(next.bucket);
  }

  function handleSelectBucket(nextBucket: string) {
    setBucket(nextBucket as MetricChartBucket);
  }

  function handleRefresh() {
    // 重算窗口（endAt 推到 now）→ 各图 query key 变更、自行 refetch；桶不变。
    setTimeWindow(computeWindow(preset));
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-3 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">大盘</h1>
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
          <Select value={bucket} onValueChange={handleSelectBucket}>
            <SelectTrigger className="h-8 w-24 rounded-none text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bucketOptions.map(option => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
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
            aria-label="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <DashboardChart
            title="状态时间占比"
            subtitle="各 App / 等待 / 桌面 · 每桶归一化到 100%"
            metricName={STATE_SAMPLE}
            aggregator="count"
            groupByTag={STATE_TAG}
            seriesMeta={stateSeriesMeta}
            chartType="stacked-area"
            range={range}
          />

          <DashboardOverlayChart
            title="工具使用次数"
            subtitle="Wait 工具 vs 所有工具的调用次数"
            total={{ label: "所有工具", metricName: TOOL_CALL, aggregator: "count" }}
            subset={{
              label: "Wait 工具",
              metricName: TOOL_CALL,
              aggregator: "count",
              tagFilters: { tool: { op: "eq", value: "wait" } },
            }}
            range={range}
          />

          <DashboardChart
            title="LLM 调用次数"
            subtitle="按模型分组"
            metricName={LLM_CALL}
            aggregator="count"
            groupByTag={MODEL_TAG}
            chartType="line"
            range={range}
          />

          <DashboardChart
            title="LLM 调用耗时均值"
            subtitle="成功调用 · 按模型分组 · 秒"
            metricName={LLM_LATENCY}
            aggregator="avg"
            groupByTag={MODEL_TAG}
            tagFilters={SUCCESS_ONLY}
            chartType="line"
            valueScale={0.001}
            range={range}
          />

          <DashboardChart
            title="LLM 调用耗时 P99"
            subtitle="成功调用 · 按模型分组 · 秒"
            metricName={LLM_LATENCY}
            aggregator="p99"
            groupByTag={MODEL_TAG}
            tagFilters={SUCCESS_ONLY}
            chartType="line"
            valueScale={0.001}
            range={range}
          />

          <DashboardCacheChart range={range} />

          <DashboardChart
            title="LLM 输出 token"
            subtitle="按模型分组"
            metricName={LLM_TOKENS}
            aggregator="sum"
            tagFilters={{ kind: { op: "eq", value: "output" } }}
            groupByTag={MODEL_TAG}
            chartType="line"
            range={range}
          />
        </div>
      </div>
    </div>
  );
}
