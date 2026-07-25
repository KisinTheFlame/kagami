import { type AuthProvider } from "@kagami/llm-api/auth";
import { type MetricPointsQueryResponse } from "@kagami/metric-api/points";
import { useMemo } from "react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { formatPercent } from "./auth-format";
import {
  TREND_COLORS,
  buildTrendChartData,
  formatTrendAxisTick,
  formatTrendTooltipLabel,
  getTrendWindowLabel,
  type TrendRange,
} from "./trend-chart-data";

/** 剩余额度趋势图：5 小时 / 7 天两条窗口线，raw 采样点照画不聚合。 */
export function UsageTrendPanel({
  data,
  providerKey,
  range,
}: {
  data: MetricPointsQueryResponse;
  providerKey: AuthProvider;
  range: TrendRange;
}) {
  const chartData = useMemo(() => buildTrendChartData(data), [data]);
  const hasPoints = chartData.some(item => item.five_hour !== null || item.seven_day !== null);
  const chartConfig = useMemo(
    () =>
      ({
        five_hour: {
          label: "5 小时",
          color: TREND_COLORS.fiveHour,
        },
        seven_day: {
          label: "7 天",
          color: TREND_COLORS.sevenDay,
        },
      }) satisfies ChartConfig,
    [],
  );

  if (!hasPoints) {
    return (
      <p className="rounded-none border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
        暂无趋势数据，历史数据会从部署后开始积累。
      </p>
    );
  }

  const gradientPrefix = `usage-trend-${providerKey}`;

  return (
    <div className="rounded-none border border-border bg-muted p-4 md:p-5">
      <ChartContainer config={chartConfig} className="h-[300px] w-full">
        <AreaChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 12, right: 12, top: 8, bottom: 8 }}
        >
          <defs>
            <linearGradient id={`${gradientPrefix}-five-hour`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-five_hour)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--color-five_hour)" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id={`${gradientPrefix}-seven-day`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-seven_day)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-seven_day)" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="occurredAt"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickFormatter={(value: string) => formatTrendAxisTick(value, range)}
          />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={value => `${value}%`}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={value => formatTrendTooltipLabel(String(value), range)}
                formatter={(value, name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div
                        className="h-2.5 w-2.5 rounded-[2px]"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{getTrendWindowLabel(String(name))}</span>
                    </div>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatPercent(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            type="linear"
            dataKey="five_hour"
            stroke="var(--color-five_hour)"
            fill={`url(#${gradientPrefix}-five-hour)`}
            strokeWidth={2}
            connectNulls
          />
          <Area
            type="linear"
            dataKey="seven_day"
            stroke="var(--color-seven_day)"
            fill={`url(#${gradientPrefix}-seven-day)`}
            strokeWidth={2}
            connectNulls
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
