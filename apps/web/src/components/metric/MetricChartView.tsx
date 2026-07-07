import { type MetricChartQueryResponse, type MetricChartSeries } from "@kagami/metric-api/chart";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatBucketLabel, formatCompactNumber, formatFullDateTime } from "./metric-format";
import { SeriesLegend, type LegendSeries } from "./SeriesLegend";
import { useSeriesVisibility } from "./useSeriesVisibility";

// === 纯展示层：只吃 data / 查询状态 + 展示 props，不发请求、不持控件状态（#444）===
//
// 图表类型适配器（#475 P4）：同一份「整洁序列」按 chartType 换画法——line/bar/stacked 走「桶 × 序列」
// 矩阵（x=时间），pie 走单值构成（每序列塌成一个切片，x=类别）。查询侧不变；pie/stacked 的构成语义
// 由使用处用「单桶查询」（bucket 覆盖整段范围）喂进来，这里只负责渲染。

/**
 * 图表画法。line/area/stacked-area/bar/stacked = 时序（x=桶）；pie = 构成（每序列一片）。
 * - `area` = 半透明叠放（overlay，各序列独立，看「子集 vs 全集」占比）。
 * - `stacked-area` = 堆叠面积 + 每桶归一化到 100%（stackOffset="expand"），看「构成占比随时间演化」。
 */
export type MetricChartType = "line" | "area" | "stacked-area" | "bar" | "stacked" | "pie";

/**
 * 序列 → 展示元数据解析器：给定序列 key（= groupByTag 的 tag 值，如状态名 "qq"/"wait"）与序号，
 * 返回稳定的 label + 颜色。用于「按语义显式配色/命名」而非 seriesColors 的 index 轮转
 * （状态占比图必须显式映射，否则新增状态会让颜色错位）。返回 undefined 时回落到默认。
 */
export type SeriesMetaResolver = (
  seriesKey: string,
  index: number,
) => { label: string; color: string } | undefined;

type MetricChartViewProps = {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  data?: MetricChartQueryResponse;
  /** 画法，默认折线。 */
  chartType?: MetricChartType;
  /** 序列展示元数据解析器（显式配色/命名）。缺省时用 seriesColors 轮转 + 后端 label。 */
  seriesMeta?: SeriesMetaResolver;
  /** 图表区高度（px），默认 288（h-72）。 */
  height?: number;
};

type ChartRow = {
  bucketLabel: string;
  bucketStart: string;
} & Record<string, number | string | null>;

export type RenderSeries = MetricChartSeries & {
  dataKey: string;
  /** 已解析的展示颜色（seriesMeta 显式映射优先，否则 seriesColors 轮转）。 */
  color: string;
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
  chartType = "line",
  seriesMeta,
  height = 288,
}: MetricChartViewProps) {
  // 显隐走共享 hook（id = series.key，语义 tag 值如 "wait"/"qq"）：纯客户端展示开关、不触发重查，
  // 跨 range/bucket 保留（key 语义稳定），刷新页面复位。同一套机器缓存图也在用。
  const { hiddenIds, toggle, isHidden } = useSeriesVisibility();

  const renderSeries = useMemo<RenderSeries[]>(
    () =>
      data?.series.map((item, index) => {
        const meta = seriesMeta?.(item.key, index);
        return {
          ...item,
          label: meta?.label ?? item.label,
          dataKey: `series_${index}`,
          color: meta?.color ?? seriesColors[index % seriesColors.length],
        };
      }) ?? [],
    [data?.series, seriesMeta],
  );
  // 可见集：仅在完整 renderSeries 上过滤——dataKey / color 已在 renderSeries 阶段按序号定死，
  // 这里绝不重新编号，否则隐藏中间项会让剩余序列串色 / 串 label。
  const visibleSeries = useMemo(
    () => selectVisibleSeries(renderSeries, hiddenIds),
    [renderSeries, hiddenIds],
  );
  // 图例吃完整序列（含隐藏项），id = series.key，color 用 resolved 值（renderSeries.color）。
  const legendSeries = useMemo<LegendSeries[]>(
    () => renderSeries.map(item => ({ id: item.key, label: item.label, color: item.color })),
    [renderSeries],
  );
  // config 按全量建：隐藏项恢复时其颜色 / label 仍可解析。
  const chartConfig = useMemo(() => buildChartConfig(renderSeries), [renderSeries]);
  const rows = useMemo(() => buildChartRows(visibleSeries), [visibleSeries]);
  const pieData = useMemo(() => buildPieData(visibleSeries), [visibleSeries]);
  // 饼图图例经 chartConfig[name].label 取字（config 按 slice name 键控，非 dataKey）；颜色仍走 Cell fill。
  const pieChartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        pieData.map(slice => [slice.name, { label: slice.name, color: slice.fill }]),
      ),
    [pieData],
  );
  const pieTotal = pieData.reduce((sum, slice) => sum + slice.value, 0);
  const hasSeries = (data?.series.length ?? 0) > 0;
  const allHidden = hasSeries && visibleSeries.length === 0;
  // 饼图额外要求构成总量 > 0（全 0 会让 recharts 角度算成 NaN、画出空白饼图但 series 非空）。
  // 其余画法只要还有可见序列即可渲染；hasRenderable 全部改吃 visibleSeries。
  const hasRenderable = chartType === "pie" ? pieTotal > 0 : visibleSeries.length > 0;
  // 全部隐藏 vs 真无数据分流：前者要引导「点图例恢复」，后者是范围内没数据。
  const emptyMessage = allHidden ? "全部序列已隐藏，点图例恢复" : "当前时间范围内没有数据。";
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

        {!isLoading && !isError && !hasRenderable ? (
          <div className={placeholderClassName} style={placeholderStyle}>
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : null}

        {!isLoading && !isError && hasRenderable && data ? (
          <>
            <ChartContainer
              className="w-full"
              style={{ height }}
              config={chartType === "pie" ? pieChartConfig : chartConfig}
            >
              {chartType === "pie" ? (
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius="80%"
                    isAnimationActive={false}
                  >
                    {pieData.map(slice => (
                      <Cell key={slice.dataKey} fill={slice.fill} />
                    ))}
                  </Pie>
                </PieChart>
              ) : chartType === "bar" || chartType === "stacked" ? (
                <BarChart
                  data={rows}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                  // stacked 用 sign offset：负值（min/avg/diff 派生可产生）按 0 轴上下分离，不在同一
                  // 累计基线回退画错。grouped bar 不堆叠，offset 无影响。
                  stackOffset={chartType === "stacked" ? "sign" : "none"}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number | string) => formatCompactNumber(value)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
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
                  {visibleSeries.map(series => (
                    <Bar
                      key={series.key}
                      dataKey={series.dataKey}
                      name={series.label}
                      fill={`var(--color-${series.dataKey})`}
                      // stacked：所有序列共用一个 stackId 叠成构成条；bar：各自成组。
                      stackId={chartType === "stacked" ? "stack" : undefined}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              ) : chartType === "stacked-area" ? (
                <AreaChart
                  data={rows}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                  // expand：每个桶把各序列值归一化到 [0,1]（累计 = 100%）。这才是「构成占比随时间
                  // 演化」——不受采样完整度（重启/丢点/卡顿导致桶总数波动）影响，高度恒为 100%。
                  // 前提：只喂 count/sum 型 metric——其空桶被 metric 服务 0-fill 成密集网格
                  //（getMissingBucketValue），各序列在每个桶都有值，expand 分母完整。avg/p95 型空桶是
                  // null（无定义），不该用堆叠面积表达占比。
                  stackOffset="expand"
                >
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 1]}
                    tickFormatter={(value: number | string) =>
                      `${Math.round(Number(value) * 100)}%`
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
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
                  {visibleSeries.map(series => (
                    <Area
                      key={series.key}
                      type="linear"
                      dataKey={series.dataKey}
                      name={series.label}
                      stroke={`var(--color-${series.dataKey})`}
                      fill={`var(--color-${series.dataKey})`}
                      // 堆叠：所有序列共用一个 stackId 叠成构成带；不透明填充，看清各带占比。
                      stackId="stack"
                      fillOpacity={0.85}
                      strokeWidth={1}
                      // 补 0 后无 null，connectNulls 无影响；显式 true 防未来数据洞破坏堆叠。
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              ) : chartType === "area" ? (
                <AreaChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number | string) => formatCompactNumber(value)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
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
                  {visibleSeries.map(series => (
                    <Area
                      key={series.key}
                      // linear 而非 monotone：面积图常用来叠「子集 vs 全集」（如 wait ⊆ 所有工具）。
                      // monotone 平滑曲线各序列独立算、只在数据点上过点，点与点之间平滑段会互相超越——
                      // 即便每个桶都满足 wait ≤ all，子集曲线也会在段间鼓包到全集之上，看着像 wait 更高。
                      // linear 直线段逐点保序：每点 wait ≤ all → 整条线处处 ≤，绝不假性反超。
                      type="linear"
                      dataKey={series.dataKey}
                      name={series.label}
                      stroke={`var(--color-${series.dataKey})`}
                      fill={`var(--color-${series.dataKey})`}
                      // 默认不堆叠、半透明叠放：子集在上层，全集的多出部分从上缘露出，直接看出占比。
                      fillOpacity={0.25}
                      strokeWidth={2}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              ) : (
                <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number | string) => formatCompactNumber(value)}
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
                  {visibleSeries.map(series => (
                    <Line
                      key={series.key}
                      type="linear"
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
              )}
            </ChartContainer>
          </>
        ) : null}

        {/* 图例独立于 recharts 图表树，只要有序列就常驻——全部隐藏时图表区换成占位、图例仍可点恢复。 */}
        {!isLoading && !isError && hasSeries ? (
          <SeriesLegend series={legendSeries} isHidden={isHidden} onToggle={toggle} />
        ) : null}

        {!isLoading && !isError && hasRenderable && data ? (
          <div className="flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
            <p>
              时间范围：{formatFullDateTime(data.startAt)} - {formatFullDateTime(data.endAt)}
            </p>
            <p>
              序列数：{data.series.length} · bucket：{data.bucket}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * 按隐藏集过滤出可见序列。仅 filter、不重排不重编号：保留各序列原 dataKey / color / 顺序，
 * 隐藏中间项也不会让剩余序列串色。喂给图表几何（rows / pieData / 各画法的 .map）。
 */
export function selectVisibleSeries(
  series: RenderSeries[],
  hiddenKeys: Set<string>,
): RenderSeries[] {
  return series.filter(item => !hiddenKeys.has(item.key));
}

function buildChartConfig(series: RenderSeries[]): ChartConfig {
  return Object.fromEntries(
    series.map(item => [
      item.dataKey,
      {
        label: item.label,
        color: item.color,
      },
    ]),
  );
}

type PieSlice = { dataKey: string; name: string; value: number; fill: string };

/**
 * pie 构成数据：每序列塌成一个切片，值 = 其各点之和的**绝对量**（null 记 0）。饼图走「单桶查询」
 * （bucket 覆盖整段范围）时每序列恰一个点，求和即那个值。取绝对量是因为饼图表达「部分占整体」，
 * 负值（min/avg 聚合或 P3 diff 派生可产生）无构成语义——recharts 会把负值画成负角度/反向切片、且把
 * 负值计入分母扭曲占比。饼图应配非负 metric，这里对误用做兜底。dataKey 供稳定 React key（label 不保唯一）。
 */
export function buildPieData(series: RenderSeries[]): PieSlice[] {
  return series.map(item => ({
    dataKey: item.dataKey,
    name: item.label,
    value: Math.abs(item.points.reduce((sum, point) => sum + (point.value ?? 0), 0)),
    fill: item.color,
  }));
}

export function buildChartRows(series: RenderSeries[]): ChartRow[] {
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
