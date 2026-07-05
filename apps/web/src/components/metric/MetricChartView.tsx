import { type MetricChartQueryResponse, type MetricChartSeries } from "@kagami/metric-api/chart";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// === 纯展示层：只吃 data / 查询状态 + 展示 props，不发请求、不持控件状态（#444）===

type MetricChartViewProps = {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  data?: MetricChartQueryResponse;
  /** 图表区高度（px），默认 288（h-72）。 */
  height?: number;
};

type ChartRow = {
  bucketLabel: string;
  bucketStart: string;
} & Record<string, number | string | null>;

type RenderSeries = MetricChartSeries & {
  dataKey: string;
};

// 鲜艳蒙德里安系列色：前 4 个饱和原色走设计 token（跟随 DESIGN.md + 暗色自适应），
// 后 4 个去饱和扩展色仅供 ≥5 系列时回落（DESIGN.md「图表扩展序列色」，无语义、不上墙）。
const seriesColors = [
  "hsl(var(--llm))",
  "hsl(var(--signal))",
  "hsl(var(--story))",
  "hsl(var(--cost))",
  "#C9892E",
  "#3F6B68",
  "#6B5D82",
  "#8A5A38",
] as const;

export function MetricChartView({
  title,
  subtitle,
  headerRight,
  isLoading,
  isError,
  errorMessage,
  data,
  height = 288,
}: MetricChartViewProps) {
  const renderSeries = useMemo<RenderSeries[]>(
    () => data?.series.map((item, index) => ({ ...item, dataKey: `series_${index}` })) ?? [],
    [data?.series],
  );
  const chartConfig = useMemo(() => buildChartConfig(renderSeries), [renderSeries]);
  const rows = useMemo(() => buildChartRows(renderSeries), [renderSeries]);
  const hasSeries = (data?.series.length ?? 0) > 0;
  const placeholderClassName = "flex items-center justify-center rounded-none border border-dashed";
  const placeholderStyle = { height };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
          </div>
          {headerRight}
        </div>
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

        {!isLoading && !isError && !hasSeries ? (
          <div className={placeholderClassName} style={placeholderStyle}>
            <p className="text-sm text-muted-foreground">当前时间范围内没有数据。</p>
          </div>
        ) : null}

        {!isLoading && !isError && hasSeries && data ? (
          <>
            <ChartContainer className="w-full" style={{ height }} config={chartConfig}>
              <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis
                  width={56}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number | string) => formatMetricValue(value)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(_label, payload) => {
                        const entry = payload?.[0]?.payload as
                          | { bucketStart?: unknown }
                          | undefined;
                        const bucketStart = entry?.bucketStart;
                        return typeof bucketStart === "string"
                          ? formatFullDateTime(bucketStart)
                          : "未知时间";
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {renderSeries.map(series => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.dataKey}
                    name={series.label}
                    stroke={`var(--color-${series.dataKey})`}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>

            <div className="flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
              <p>
                时间范围：{formatFullDateTime(data.startAt)} - {formatFullDateTime(data.endAt)}
              </p>
              <p>
                序列数：{data.series.length} · bucket：{data.bucket}
              </p>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function buildChartConfig(series: RenderSeries[]): ChartConfig {
  return Object.fromEntries(
    series.map((item, index) => [
      item.dataKey,
      {
        label: item.label,
        color: seriesColors[index % seriesColors.length],
      },
    ]),
  );
}

function buildChartRows(series: RenderSeries[]): ChartRow[] {
  const rowsByBucketStart = new Map<string, ChartRow>();

  for (const item of series) {
    for (const point of item.points) {
      const existingRow =
        rowsByBucketStart.get(point.bucketStart) ??
        ({
          bucketLabel: formatBucketLabel(point.bucketStart),
          bucketStart: point.bucketStart,
        } satisfies ChartRow);

      existingRow[item.dataKey] = point.value;
      rowsByBucketStart.set(point.bucketStart, existingRow);
    }
  }

  return [...rowsByBucketStart.values()].sort((left, right) =>
    left.bucketStart.localeCompare(right.bucketStart),
  );
}

function formatBucketLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFullDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatMetricValue(value: number | string): string {
  if (typeof value !== "number") {
    return String(value);
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("zh-CN", {
      maximumFractionDigits: 1,
    });
  }

  return value.toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
}
