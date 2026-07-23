import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  formatCompactNumber,
  formatFullDateTime,
  formatMetricValue,
} from "@/components/metric/metric-format";
import { SeriesLegend, type LegendSeries } from "@/components/metric/SeriesLegend";
import { useMetricChartData } from "@/components/metric/useMetricChartData";
import { useMetricDerivedData } from "@/components/metric/useMetricDerivedData";
import { useSeriesVisibility } from "@/components/metric/useSeriesVisibility";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getApiErrorMessage } from "@/lib/api";
import { buildCacheRows } from "./dashboard-cache";
import type { DashboardRange } from "./dashboard-charts";

// 主 Agent 输入 token 缓存图：一张双 Y 轴 composed 图同时给出「用了多少 token」（左轴面积）与「命中率
// 多少」（右轴线，%）——把绝对量与派生比率合进一张，不再分两张。命中率走 P3 /metric/derive
// （cache_hit ÷ input_total），口径收在后端。两条查询共享同一 range，桶轴对齐。

const LLM_TOKENS = "llm.call.tokens";
// 只看主 Agent：按 scene=agent 过滤。usage=agent 会混入 fork 型调用
// （contextSummarizer / innerVoice / todoSuggestionAgent，它们共享 usage=agent 缓存身份），
// scene 才是「哪个业务场景」的归因维度（issue #555）。
const AGENT_SCENE = { scene: { op: "eq" as const, value: "agent" } };
const CHART_HEIGHT = 300;

const chartConfig = {
  tokens: { label: "总输入 token", color: "hsl(var(--llm))" },
  ratePct: { label: "缓存命中率", color: "hsl(var(--story))" },
} satisfies ChartConfig;

// 图例吃固定 2 序列，id = dataKey；color 用 chartConfig 的 resolved 值（在 ChartContainer 外也解析）。
const legendSeries: LegendSeries[] = [
  { id: "tokens", label: chartConfig.tokens.label, color: chartConfig.tokens.color },
  { id: "ratePct", label: chartConfig.ratePct.label, color: chartConfig.ratePct.color },
];

export function DashboardCacheChart({ range }: { range: DashboardRange }) {
  const totalQuery = useMetricChartData({
    metricName: LLM_TOKENS,
    aggregator: "sum",
    bucket: range.bucket,
    startAt: range.startAt,
    endAt: range.endAt,
    tagFilters: { ...AGENT_SCENE, kind: { op: "eq", value: "input_total" } },
  });
  const rateQuery = useMetricDerivedData({
    numerator: {
      metricName: LLM_TOKENS,
      aggregator: "sum",
      tagFilters: { ...AGENT_SCENE, kind: { op: "eq", value: "input_cache_hit" } },
    },
    denominator: {
      metricName: LLM_TOKENS,
      aggregator: "sum",
      tagFilters: { ...AGENT_SCENE, kind: { op: "eq", value: "input_total" } },
    },
    op: "ratio",
    bucket: range.bucket,
    startAt: range.startAt,
    endAt: range.endAt,
  });

  const rows = useMemo(
    () => buildCacheRows(totalQuery.data, rateQuery.data),
    [totalQuery.data, rateQuery.data],
  );
  // 命中率 Y 轴自适应：数据全在 90-100 就放大到 [90,100] 看高区间波动；一旦有 <90 的点就回退 [0,100]。
  const rateDomain = useMemo<[number, number]>(() => {
    const hasBelow90 = rows.some(row => row.ratePct !== null && row.ratePct < 90);
    return hasBelow90 ? [0, 100] : [90, 100];
  }, [rows]);

  // 显隐走共享 hook（id = 固定 dataKey "tokens"/"ratePct"）。隐藏某条时，连同其 Y 轴一起条件渲染掉，
  // 避免留一根空轴误导（Codex 复核点）。
  const { toggle, isHidden } = useSeriesVisibility();
  const tokensHidden = isHidden("tokens");
  const rateHidden = isHidden("ratePct");
  const allHidden = tokensHidden && rateHidden;

  const isLoading = totalQuery.isLoading || rateQuery.isLoading;
  const isError = totalQuery.isError || rateQuery.isError;
  const errorMessage = totalQuery.isError
    ? getApiErrorMessage(totalQuery.error)
    : rateQuery.isError
      ? getApiErrorMessage(rateQuery.error)
      : undefined;
  const emptyMessage = allHidden ? "全部序列已隐藏，点图例恢复" : "当前时间范围内没有数据。";
  const placeholderClassName = "flex items-center justify-center rounded-none border border-dashed";
  const placeholderStyle = { height: CHART_HEIGHT };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 pb-4">
        <CardTitle className="text-lg">主 Agent 输入 token</CardTitle>
        <CardDescription>总输入量（左轴）与缓存命中率（右轴）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className={placeholderClassName} style={placeholderStyle}>
            <p className="text-sm text-muted-foreground">正在加载图表数据…</p>
          </div>
        ) : null}

        {!isLoading && isError ? (
          <div className={placeholderClassName} style={placeholderStyle}>
            <p className="text-sm text-destructive">数据加载失败：{errorMessage ?? "未知错误"}</p>
          </div>
        ) : null}

        {!isLoading && !isError && rows.length === 0 ? (
          <div className={placeholderClassName} style={placeholderStyle}>
            <p className="text-sm text-muted-foreground">当前时间范围内没有数据。</p>
          </div>
        ) : null}

        {!isLoading && !isError && rows.length > 0 && allHidden ? (
          <div className={placeholderClassName} style={placeholderStyle}>
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : null}

        {!isLoading && !isError && rows.length > 0 && !allHidden ? (
          <ChartContainer className="w-full" style={{ height: CHART_HEIGHT }} config={chartConfig}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
              {!tokensHidden ? (
                <YAxis
                  yAxisId="tokens"
                  width={56}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number | string) => formatCompactNumber(value)}
                />
              ) : null}
              {!rateHidden ? (
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  width={44}
                  domain={rateDomain}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number | string) =>
                    typeof value === "number" ? `${value}%` : String(value)
                  }
                />
              ) : null}
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_label, payload) => {
                      const entry = payload?.[0]?.payload as { bucketStart?: unknown } | undefined;
                      const bucketStart = entry?.bucketStart;
                      return typeof bucketStart === "string"
                        ? formatFullDateTime(bucketStart)
                        : "未知时间";
                    }}
                    // 自定义每行：命中率带 % 单位、token 千分位；且 0 值也显示（默认 falsy 守卫会吞 0）。
                    formatter={(value, name, item) => {
                      const numeric = typeof value === "number" ? value : Number(value);
                      const suffix = item?.dataKey === "ratePct" ? "%" : "";
                      return (
                        <div className="flex flex-1 justify-between gap-3 leading-none">
                          <span className="text-muted-foreground">{name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatMetricValue(numeric)}
                            {suffix}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              {!tokensHidden ? (
                <Line
                  yAxisId="tokens"
                  type="linear"
                  dataKey="tokens"
                  name="总输入 token"
                  stroke="var(--color-tokens)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null}
              {!rateHidden ? (
                <Line
                  yAxisId="rate"
                  type="linear"
                  dataKey="ratePct"
                  name="缓存命中率"
                  stroke="var(--color-ratePct)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : null}
            </ComposedChart>
          </ChartContainer>
        ) : null}

        {!isLoading && !isError && rows.length > 0 ? (
          <SeriesLegend series={legendSeries} isHidden={isHidden} onToggle={toggle} />
        ) : null}
      </CardContent>
    </Card>
  );
}
