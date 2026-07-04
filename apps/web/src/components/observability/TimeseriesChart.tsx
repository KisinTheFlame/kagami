import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type TimeseriesSeries = {
  key: string;
  label: string;
  color: string;
  points: { bucketStart: string; value: number | null }[];
};

type TimeseriesChartProps = {
  series: TimeseriesSeries[];
  /** 点击某个时间点（桶）时回传该桶的 bucketStart（ISO），用于下钻。 */
  onBucketClick?: (bucketStart: string) => void;
  valueFormatter?: (value: number) => string;
};

type MergedRow = { bucketStart: string } & Record<string, number | null | string>;

/** 多系列折线：把各系列按 bucketStart 归并成 recharts 行；点击时间点触发下钻。 */
export function TimeseriesChart({ series, onBucketClick, valueFormatter }: TimeseriesChartProps) {
  const rows = useMemo(() => mergeSeries(series), [series]);
  const config = useMemo<ChartConfig>(() => {
    const entries: ChartConfig = {};
    for (const item of series) {
      entries[item.key] = { label: item.label, color: item.color };
    }
    return entries;
  }, [series]);

  return (
    <ChartContainer className="h-72 w-full" config={config}>
      <LineChart
        data={rows}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        onClick={state => {
          const label = state?.activeLabel;
          if (typeof label === "string" && onBucketClick) {
            onBucketClick(label);
          }
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bucketStart"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={formatTick}
        />
        <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={label => (typeof label === "string" ? formatTooltipLabel(label) : "")}
              {...(valueFormatter
                ? { formatter: (value: unknown) => formatChartValue(value, valueFormatter) }
                : {})}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map(item => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            stroke={`var(--color-${item.key})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
            className={onBucketClick ? "cursor-pointer" : undefined}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

function mergeSeries(series: TimeseriesSeries[]): MergedRow[] {
  const byBucket = new Map<string, MergedRow>();
  for (const item of series) {
    for (const point of item.points) {
      const existing = byBucket.get(point.bucketStart) ?? { bucketStart: point.bucketStart };
      existing[item.key] = point.value;
      byBucket.set(point.bucketStart, existing);
    }
  }
  return [...byBucket.values()].sort((left, right) =>
    left.bucketStart < right.bucketStart ? -1 : left.bucketStart > right.bucketStart ? 1 : 0,
  );
}

function formatTick(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTooltipLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatChartValue(value: unknown, formatter: (value: number) => string): string {
  return typeof value === "number" ? formatter(value) : "—";
}
