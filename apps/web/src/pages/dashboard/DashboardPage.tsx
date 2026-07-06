import type { MetricChartBucket } from "@kagami/metric-api/chart";
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
import { DashboardCacheChart } from "./DashboardCacheChart";
import { DashboardChart, DashboardOverlayChart, type DashboardRange } from "./dashboard-charts";

// === 大盘 ===
//
// 一个页面级共享的时间范围 + bucket，一栅格多图（工具使用 + LLM 调用量/延迟/token）。所有图对齐同一
// range、一起刷新。查询定义就近声明在这里；图组件只吃 spec + range，不各自持控件。

const TOOL_CALL = "agent.tool.call";
const LLM_CALL = "llm.call";
const LLM_LATENCY = "llm.call.latency";
const LLM_TOKENS = "llm.call.tokens";
const MODEL_TAG = "model";

// 延迟图只算成功调用：失败（尤其超时，latency=整个超时时长）会污染 avg/P99 读数。
const SUCCESS_ONLY = { status: { op: "eq" as const, value: "success" } };

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

function computeRange(preset: RangePreset): DashboardRange {
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - preset.rangeMs);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString(), bucket: preset.bucket };
}

export function DashboardPage() {
  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET.key);
  const preset = RANGE_PRESETS.find(item => item.key === presetKey) ?? DEFAULT_PRESET;
  // range 只在初次 / 换 preset / 手动刷新时重算一次，所有图共享，保证桶轴对齐、也避免每次渲染 refetch。
  const [range, setRange] = useState<DashboardRange>(() => computeRange(DEFAULT_PRESET));

  function handleSelectPreset(nextKey: string) {
    const next = RANGE_PRESETS.find(item => item.key === nextKey) ?? DEFAULT_PRESET;
    setPresetKey(next.key);
    setRange(computeRange(next));
  }

  function handleRefresh() {
    // 重算 range（endAt 推到 now）→ 各图 query key 变更、自行 refetch 并显示各自 loading 态。
    setRange(computeRange(preset));
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
            chartType="area"
            range={range}
          />
        </div>
      </div>
    </div>
  );
}
