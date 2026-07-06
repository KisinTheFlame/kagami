import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  formatCompactNumber,
  formatFullDateTime,
  formatMetricValue,
} from "@/components/metric/metric-format";
import { useMetricChartData } from "@/components/metric/useMetricChartData";
import { useMetricDerivedData } from "@/components/metric/useMetricDerivedData";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
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
const AGENT_USAGE = { usage: { op: "eq" as const, value: "agent" } };
const CHART_HEIGHT = 300;

const chartConfig = {
  tokens: { label: "总输入 token", color: "hsl(var(--llm))" },
  ratePct: { label: "缓存命中率", color: "hsl(var(--story))" },
} satisfies ChartConfig;

export function DashboardCacheChart({ range }: { range: DashboardRange }) {
  const totalQuery = useMetricChartData({
    metricName: LLM_TOKENS,
    aggregator: "sum",
    bucket: range.bucket,
    startAt: range.startAt,
    endAt: range.endAt,
    tagFilters: { ...AGENT_USAGE, kind: { op: "eq", value: "input_total" } },
  });
  const rateQuery = useMetricDerivedData({
    numerator: {
      metricName: LLM_TOKENS,
      aggregator: "sum",
      tagFilters: { ...AGENT_USAGE, kind: { op: "eq", value: "input_cache_hit" } },
    },
    denominator: {
      metricName: LLM_TOKENS,
      aggregator: "sum",
      tagFilters: { ...AGENT_USAGE, kind: { op: "eq", value: "input_total" } },
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

  const isLoading = totalQuery.isLoading || rateQuery.isLoading;
  const isError = totalQuery.isError || rateQuery.isError;
  const errorMessage = totalQuery.isError
    ? getApiErrorMessage(totalQuery.error)
    : rateQuery.isError
      ? getApiErrorMessage(rateQuery.error)
      : undefined;
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

        {!isLoading && !isError && rows.length > 0 ? (
          <ChartContainer className="w-full" style={{ height: CHART_HEIGHT }} config={chartConfig}>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                yAxisId="tokens"
                width={56}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number | string) => formatCompactNumber(value)}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                width={44}
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number | string) =>
                  typeof value === "number" ? `${value}%` : String(value)
                }
              />
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
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                yAxisId="tokens"
                type="linear"
                dataKey="tokens"
                name="总输入 token"
                stroke="var(--color-tokens)"
                fill="var(--color-tokens)"
                fillOpacity={0.2}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="ratePct"
                name="缓存命中率"
                stroke="var(--color-ratePct)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        ) : null}
      </CardContent>
    </Card>
  );
}
