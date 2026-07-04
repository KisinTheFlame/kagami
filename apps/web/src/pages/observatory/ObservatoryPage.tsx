import { contractUrl } from "@kagami/http/url";
import { metricApiContract } from "@kagami/metric-api/contract";
import {
  type LlmOverviewResponse,
  LlmOverviewResponseSchema,
  type LlmTimeseriesResponse,
  LlmTimeseriesResponseSchema,
  type ObservabilityMetric,
} from "@kagami/metric-api/observability";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ModelPieChart } from "@/components/observability/ModelPieChart";
import { ObservabilityPanel } from "@/components/observability/ObservabilityPanel";
import { StatCard } from "@/components/observability/StatCard";
import { TimeseriesChart, type TimeseriesSeries } from "@/components/observability/TimeseriesChart";
import { Button } from "@/components/ui/button";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import {
  RANGE_PRESETS,
  type RangePresetKey,
  bucketMillis,
  buildLlmHistoryDrillUrl,
  deriveBucket,
  seriesColorAt,
} from "@/lib/observability";

type SelectedModel = { provider: string; model: string };

// Date.now() 单独裹进模块级函数：react-hooks/purity 规则禁止在组件内直接调不纯函数，
// 模块级 helper 不在其扫描面内（同 AuthPage 的既有写法）。
function readNowMs(): number {
  return Date.now();
}

export function ObservatoryPage() {
  const navigate = useNavigate();
  const [rangeKey, setRangeKey] = useState<RangePresetKey>("1h");
  // 锚定 now：范围/刷新时才重取，避免每次渲染 now 漂移导致 queryKey 抖动、缓存失效。
  const [anchorMs, setAnchorMs] = useState<number>(readNowMs);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);

  const range = useMemo(() => {
    const preset = RANGE_PRESETS.find(item => item.key === rangeKey) ?? RANGE_PRESETS[1];
    const to = new Date(anchorMs).toISOString();
    const from = new Date(anchorMs - preset.ms).toISOString();
    return { from, to, bucket: deriveBucket(preset.ms) };
  }, [rangeKey, anchorMs]);

  function reanchor(nextKey: RangePresetKey): void {
    setRangeKey(nextKey);
    setAnchorMs(readNowMs());
    setSelectedModel(null);
  }

  const overviewQuery = useQuery(
    createSchemaQueryOptions<
      LlmOverviewResponse,
      ReturnType<typeof queryKeys.observability.llmOverview>
    >({
      queryKey: queryKeys.observability.llmOverview({ from: range.from, to: range.to }),
      path: contractUrl(metricApiContract.llmOverview),
      schema: LlmOverviewResponseSchema,
      params: { from: range.from, to: range.to },
    }),
  );

  const callsQuery = useTimeseries(range, "calls");
  const errorsQuery = useTimeseries(range, "errors");
  const p95Query = useTimeseries(range, "latencyP95");
  const avgQuery = useTimeseries(range, "latencyAvg");
  const focusedQuery = useTimeseries(
    range,
    "calls",
    selectedModel ?? undefined,
    selectedModel !== null,
  );

  const overview = overviewQuery.data;
  const hasNoCalls = overview?.totalCalls === 0;

  const trendSeries: TimeseriesSeries[] = [
    toSingleSeries(callsQuery.data, "calls", "调用量", seriesColorAt(0)),
    toSingleSeries(errorsQuery.data, "errors", "错误", seriesColorAt(1)),
  ];
  const latencySeries: TimeseriesSeries[] = [
    toSingleSeries(p95Query.data, "p95", "p95 延迟", seriesColorAt(3)),
    toSingleSeries(avgQuery.data, "avg", "平均延迟", seriesColorAt(0)),
  ];
  const focusedSeries: TimeseriesSeries[] = [
    toSingleSeries(focusedQuery.data, "calls", selectedModel?.model ?? "调用量", seriesColorAt(0)),
  ];

  const bucketMs = bucketMillis(range.bucket);

  function drillToBucket(bucketStart: string, model?: SelectedModel): void {
    // 窗口右端点减 1ms：llm-history 时间过滤是闭区间（createdAt <= to），不减的话恰在下一桶
    // 起点的调用会同时落进相邻两桶的下钻明细（边界串桶）。
    const to = new Date(new Date(bucketStart).getTime() + bucketMs - 1).toISOString();
    void navigate(
      buildLlmHistoryDrillUrl({
        from: bucketStart,
        to,
        ...(model ? { provider: model.provider, model: model.model } : {}),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-xl font-semibold">小镜行为观察台 · LLM</h1>
          <p className="text-sm text-muted-foreground">直连调用记录聚合，观察小镜最近的 LLM 活动</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_PRESETS.map(preset => (
            <Button
              key={preset.key}
              size="sm"
              variant={preset.key === rangeKey ? "default" : "outline"}
              onClick={() => reanchor(preset.key)}
            >
              {preset.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => reanchor(rangeKey)}>
            刷新
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="总调用"
          value={formatInt(overview?.totalCalls)}
          tone="llm"
          isLoading={overviewQuery.isLoading}
        />
        <StatCard
          label="错误率"
          value={formatPercent(overview?.errorRate)}
          hint={overview ? `${formatInt(overview.errorCount)} 次失败` : undefined}
          tone="signal"
          isLoading={overviewQuery.isLoading}
        />
        <StatCard
          label="p95 延迟"
          value={formatMs(overview?.latencyP95Ms)}
          isLoading={overviewQuery.isLoading}
        />
        <StatCard
          label="平均延迟"
          value={formatMs(overview?.latencyAvgMs)}
          isLoading={overviewQuery.isLoading}
        />
        <StatCard
          label="总 token"
          value={formatInt(overview?.tokens.total)}
          tone="cost"
          isLoading={overviewQuery.isLoading}
        />
        <StatCard
          label="缓存命中 token"
          value={formatInt(overview?.tokens.cacheHit)}
          hint={overview ? `未命中 ${formatInt(overview.tokens.cacheMiss)}` : undefined}
          tone="llm"
          isLoading={overviewQuery.isLoading}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ObservabilityPanel
          title="模型分布"
          description="点击扇区聚焦该模型的调用时序"
          isLoading={overviewQuery.isLoading}
          isError={overviewQuery.isError}
          isEmpty={!overview || overview.byModel.length === 0}
        >
          <ModelPieChart
            items={overview?.byModel ?? []}
            onSliceClick={item => setSelectedModel({ provider: item.provider, model: item.model })}
          />
        </ObservabilityPanel>

        <ObservabilityPanel
          title="调用量与错误"
          description="点击时间点下钻到该时段明细"
          isLoading={callsQuery.isLoading || errorsQuery.isLoading}
          isError={callsQuery.isError || errorsQuery.isError}
          isEmpty={hasNoCalls}
        >
          <TimeseriesChart
            series={trendSeries}
            onBucketClick={bucketStart => drillToBucket(bucketStart)}
            valueFormatter={value => formatInt(value)}
          />
        </ObservabilityPanel>
      </div>

      <ObservabilityPanel
        title="延迟 (ms)"
        description="p95 与平均延迟；单样本桶不产出 p95 点"
        isLoading={p95Query.isLoading || avgQuery.isLoading}
        isError={p95Query.isError || avgQuery.isError}
        isEmpty={hasNoCalls}
      >
        <TimeseriesChart
          series={latencySeries}
          valueFormatter={value => `${Math.round(value)} ms`}
        />
      </ObservabilityPanel>

      {selectedModel ? (
        <ObservabilityPanel
          title={`「${selectedModel.model}」调用时序`}
          description="点击时间点下钻到该模型该时段的调用明细"
          isLoading={focusedQuery.isLoading}
          isError={focusedQuery.isError}
          isEmpty={false}
          actions={
            <Button size="sm" variant="outline" onClick={() => setSelectedModel(null)}>
              取消聚焦
            </Button>
          }
        >
          <TimeseriesChart
            series={focusedSeries}
            onBucketClick={bucketStart => drillToBucket(bucketStart, selectedModel)}
            valueFormatter={value => formatInt(value)}
          />
        </ObservabilityPanel>
      ) : null}
    </div>
  );
}

function useTimeseries(
  range: { from: string; to: string; bucket: string },
  metric: ObservabilityMetric,
  filter?: SelectedModel,
  enabled = true,
) {
  const params = {
    from: range.from,
    to: range.to,
    bucket: range.bucket,
    metric,
    ...(filter ? { provider: filter.provider, model: filter.model } : {}),
  } satisfies Record<string, string | undefined>;

  return useQuery({
    ...createSchemaQueryOptions<
      LlmTimeseriesResponse,
      ReturnType<typeof queryKeys.observability.llmTimeseries>
    >({
      queryKey: queryKeys.observability.llmTimeseries(params),
      path: contractUrl(metricApiContract.llmTimeseries),
      schema: LlmTimeseriesResponseSchema,
      params,
    }),
    enabled,
  });
}

function toSingleSeries(
  data: LlmTimeseriesResponse | undefined,
  key: string,
  label: string,
  color: string,
): TimeseriesSeries {
  const series = data?.series[0];
  return { key, label, color, points: series?.points ?? [] };
}

function formatInt(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return value.toLocaleString();
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${Math.round(value)} ms`;
}
