import {
  MetricChartAggregatorSchema,
  MetricChartCreateRequestSchema,
  MetricChartCreateResponseSchema,
  MetricChartDataQuerySchema,
  MetricChartDataResponseSchema,
  MetricChartListResponseSchema,
  MetricChartTagFiltersSchema,
  type MetricChartAggregator,
  type MetricChartBucket,
  type MetricChartCreateRequest,
  type MetricChartDataQuery,
  type MetricChartDefinition,
  type MetricChartRangePreset,
  type MetricChartSeries,
} from "@kagami/shared/schemas/metric-chart";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPost, apiPostWithSchema, getApiErrorMessage } from "@/lib/api";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { isoToLocalDateTime, localDateTimeToIso } from "@/lib/search-params";
import { cn } from "@/lib/utils";

type AppliedRange =
  | {
      kind: "preset";
      rangePreset: MetricChartRangePreset;
    }
  | {
      kind: "custom";
      startAt: string;
      endAt: string;
    };

type ChartRow = {
  bucketLabel: string;
  bucketStart: string;
} & Record<string, number | string | null>;

type RenderSeries = MetricChartSeries & {
  dataKey: string;
};

const rangePresets = [
  "1m",
  "10m",
  "30m",
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "2d",
] as const satisfies readonly MetricChartRangePreset[];

const bucketOptions = [
  "10s",
  "1m",
  "5m",
  "30m",
  "1h",
] as const satisfies readonly MetricChartBucket[];

const aggregatorOptions = MetricChartAggregatorSchema.options;

const defaultBucketByPreset: Record<MetricChartRangePreset, MetricChartBucket> = {
  "1m": "10s",
  "10m": "1m",
  "30m": "1m",
  "1h": "5m",
  "3h": "5m",
  "6h": "30m",
  "12h": "30m",
  "1d": "1h",
  "2d": "1h",
};

const seriesColors = [
  "#0f766e",
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#d97706",
  "#059669",
  "#db2777",
  "#0891b2",
] as const;

const inputClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function MetricChartsPage() {
  const queryClient = useQueryClient();
  const [appliedRange, setAppliedRange] = useState<AppliedRange>({
    kind: "preset",
    rangePreset: "1h",
  });
  const [selectedPreset, setSelectedPreset] = useState<MetricChartRangePreset>("1h");
  const [bucket, setBucket] = useState<MetricChartBucket>(defaultBucketByPreset["1h"]);
  const [bucketTouched, setBucketTouched] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const defaultCustomRange = getDefaultCustomRangeInputs();
  const [customStartInput, setCustomStartInput] = useState(defaultCustomRange.start);
  const [customEndInput, setCustomEndInput] = useState(defaultCustomRange.end);
  const [customRangeError, setCustomRangeError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [chartPendingDelete, setChartPendingDelete] = useState<MetricChartDefinition | null>(null);
  const [createForm, setCreateForm] = useState({
    chartName: "",
    metricName: "",
    aggregator: "count" as MetricChartAggregator,
    groupByTag: "",
    tagFiltersText: "",
  });

  const chartListQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.metricChart.list(),
      path: "/metric-chart/list",
      schema: MetricChartListResponseSchema,
    }),
  });

  const createChartMutation = useMutation({
    mutationFn: async (input: MetricChartCreateRequest) =>
      apiPostWithSchema("/metric-chart/create", input, MetricChartCreateResponseSchema),
    onSuccess: async () => {
      setCreateForm({
        chartName: "",
        metricName: "",
        aggregator: "count",
        groupByTag: "",
        tagFiltersText: "",
      });
      setCreateError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.metricChart.list() });
    },
  });

  const deleteChartMutation = useMutation({
    mutationFn: async (chartName: string) => {
      const response = await apiPost("/metric-chart/delete", { chartName });
      return response.body;
    },
    onSuccess: async () => {
      setChartPendingDelete(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.metricChart.list() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.metricChart.dataRoot() }),
      ]);
    },
  });

  async function handleManualRefresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.metricChart.list() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.metricChart.dataRoot() }),
    ]);
  }

  function handleSelectPreset(nextPreset: MetricChartRangePreset) {
    setAppliedRange({ kind: "preset", rangePreset: nextPreset });
    setSelectedPreset(nextPreset);
    setCustomRangeError(null);

    if (!bucketTouched) {
      setBucket(defaultBucketByPreset[nextPreset]);
    }
  }

  function handleApplyCustomRange() {
    const startAt = localDateTimeToIso(customStartInput);
    const endAt = localDateTimeToIso(customEndInput);

    if (!startAt || !endAt) {
      setCustomRangeError("请填写合法的开始和结束时间。");
      return;
    }

    const parsed = MetricChartDataQuerySchema.safeParse({
      chartName: "__preview__",
      bucket,
      startAt,
      endAt,
    });

    if (!parsed.success) {
      setCustomRangeError(parsed.error.issues[0]?.message ?? "时间范围不合法。");
      return;
    }

    setAppliedRange({ kind: "custom", startAt, endAt });
    setCustomRangeError(null);

    if (!bucketTouched) {
      setBucket(
        getDefaultBucketByDuration(new Date(endAt).getTime() - new Date(startAt).getTime()),
      );
    }
  }

  async function handleCreateChart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const tagFilters = parseTagFiltersText(createForm.tagFiltersText);
      const input = MetricChartCreateRequestSchema.parse({
        chartName: createForm.chartName,
        metricName: createForm.metricName,
        aggregator: createForm.aggregator,
        groupByTag: createForm.groupByTag,
        tagFilters,
      });

      setCreateError(null);
      await createChartMutation.mutateAsync(input);
    } catch (error) {
      setCreateError(getErrorMessage(error));
    }
  }

  const charts = chartListQuery.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-auto bg-muted/20">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-3 md:p-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,26rem)]">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Metric 图表</CardTitle>
              <CardDescription>
                先加载全部图表定义，再按图分别查询数据。当前只展示默认定义驱动的折线图。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">时间范围</p>
                <div className="flex flex-wrap gap-2">
                  {rangePresets.map(preset => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={
                        appliedRange.kind === "preset" && appliedRange.rangePreset === preset
                          ? "default"
                          : "outline"
                      }
                      onClick={() => handleSelectPreset(preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
                <div className="space-y-2">
                  <p className="text-sm font-medium">聚合粒度</p>
                  <Select
                    value={bucket}
                    onValueChange={value => {
                      setBucket(value as MetricChartBucket);
                      setBucketTouched(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {bucketOptions.map(option => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">高级时间</p>
                      <p className="text-xs text-muted-foreground">
                        使用自定义开始和结束时间覆盖预设范围。
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsAdvancedOpen(open => !open)}
                    >
                      {isAdvancedOpen ? "收起" : "展开"}
                    </Button>
                  </div>

                  {isAdvancedOpen ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-medium">开始时间</span>
                        <input
                          className={inputClassName}
                          type="datetime-local"
                          value={customStartInput}
                          onChange={event => setCustomStartInput(event.target.value)}
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-medium">结束时间</span>
                        <input
                          className={inputClassName}
                          type="datetime-local"
                          value={customEndInput}
                          onChange={event => setCustomEndInput(event.target.value)}
                        />
                      </label>
                      <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" onClick={handleApplyCustomRange}>
                          应用自定义时间
                        </Button>
                        {appliedRange.kind === "custom" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleSelectPreset(selectedPreset)}
                          >
                            恢复预设
                          </Button>
                        ) : null}
                        {customRangeError ? (
                          <p className="text-sm text-destructive">{customRangeError}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    当前范围：
                    {appliedRange.kind === "preset"
                      ? `最近 ${appliedRange.rangePreset}`
                      : `${formatFullDateTime(appliedRange.startAt)} - ${formatFullDateTime(appliedRange.endAt)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    当前 bucket 为 {bucket}
                    {bucketTouched ? "，已手动固定" : "，会随默认规则自动切换"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleManualRefresh()}
                  disabled={chartListQuery.isFetching}
                >
                  <RefreshCw
                    className={cn("mr-2 h-4 w-4", chartListQuery.isFetching && "animate-spin")}
                  />
                  手动刷新
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>创建图表</CardTitle>
              <CardDescription>
                创建的定义会直接绑定一个 metric，并可附带默认筛选和分组配置。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateChart}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium">图表名称</span>
                    <input
                      className={inputClassName}
                      placeholder="tool-call-count"
                      value={createForm.chartName}
                      onChange={event =>
                        setCreateForm(form => ({ ...form, chartName: event.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Metric 名称</span>
                    <input
                      className={inputClassName}
                      placeholder="tool.call"
                      value={createForm.metricName}
                      onChange={event =>
                        setCreateForm(form => ({ ...form, metricName: event.target.value }))
                      }
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">聚合方式</span>
                    <Select
                      value={createForm.aggregator}
                      onValueChange={value =>
                        setCreateForm(form => ({
                          ...form,
                          aggregator: value as MetricChartAggregator,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aggregatorOptions.map(option => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">按 Tag 拆线</span>
                    <input
                      className={inputClassName}
                      placeholder="model"
                      value={createForm.groupByTag}
                      onChange={event =>
                        setCreateForm(form => ({ ...form, groupByTag: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="space-y-2">
                  <span className="text-sm font-medium">默认 Tag Filters JSON</span>
                  <textarea
                    className={textareaClassName}
                    placeholder={'{"provider":"openai"}'}
                    value={createForm.tagFiltersText}
                    onChange={event =>
                      setCreateForm(form => ({ ...form, tagFiltersText: event.target.value }))
                    }
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      `tagFilters` 只支持字符串 kv 精确匹配，`groupByTag` 只支持单个字段。
                    </p>
                    {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
                  </div>
                  <Button type="submit" disabled={createChartMutation.isPending}>
                    {createChartMutation.isPending ? "创建中…" : "创建图表"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">图表列表</h2>
              <p className="text-sm text-muted-foreground">
                共 {charts.length} 张图，每张图单独请求数据。
              </p>
            </div>
          </div>

          {chartListQuery.isLoading ? (
            <Card>
              <CardContent className="flex min-h-40 items-center justify-center">
                <p className="text-sm text-muted-foreground">正在加载图表定义…</p>
              </CardContent>
            </Card>
          ) : null}

          {chartListQuery.isError ? (
            <Card>
              <CardContent className="flex min-h-40 items-center justify-center">
                <p className="text-sm text-destructive">
                  图表定义加载失败：{getErrorMessage(chartListQuery.error)}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {!chartListQuery.isLoading && !chartListQuery.isError && charts.length === 0 ? (
            <Card>
              <CardContent className="flex min-h-40 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  还没有任何图表定义，可以先在右上角创建一张图。
                </p>
              </CardContent>
            </Card>
          ) : null}

          {charts.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              {charts.map(chart => (
                <MetricChartCard
                  key={chart.chartName}
                  chart={chart}
                  bucket={bucket}
                  appliedRange={appliedRange}
                  onDelete={() => setChartPendingDelete(chart)}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <DeleteMetricChartDialog
        chart={chartPendingDelete}
        isPending={deleteChartMutation.isPending}
        onClose={() => {
          if (!deleteChartMutation.isPending) {
            setChartPendingDelete(null);
          }
        }}
        onConfirm={() => {
          if (!chartPendingDelete) {
            return;
          }

          void deleteChartMutation.mutateAsync(chartPendingDelete.chartName);
        }}
        errorMessage={
          deleteChartMutation.isError ? getErrorMessage(deleteChartMutation.error) : null
        }
      />
    </div>
  );
}

function MetricChartCard({
  chart,
  bucket,
  appliedRange,
  onDelete,
}: {
  chart: MetricChartDefinition;
  bucket: MetricChartBucket;
  appliedRange: AppliedRange;
  onDelete: () => void;
}) {
  const query = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.metricChart.data(chart.chartName, bucket, appliedRange),
      path: "/metric-chart/data",
      schema: MetricChartDataResponseSchema,
      params: (() => {
        const request = buildMetricChartDataQuery(chart.chartName, bucket, appliedRange);
        return {
          chartName: request.chartName,
          bucket: request.bucket,
          rangePreset: request.rangePreset,
          startAt: request.startAt,
          endAt: request.endAt,
        } satisfies Record<string, string | undefined>;
      })(),
    }),
  });

  const chartData = query.data;
  const renderSeries = useMemo(
    () => chartData?.series.map((item, index) => ({ ...item, dataKey: `series_${index}` })) ?? [],
    [chartData?.series],
  );
  const chartConfig = useMemo(() => buildChartConfig(renderSeries), [renderSeries]);
  const rows = useMemo(() => buildChartRows(renderSeries), [renderSeries]);
  const hasSeries = (chartData?.series.length ?? 0) > 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">{chart.chartName}</CardTitle>
            <CardDescription>metric: {chart.metricName}</CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <InfoPill label={`聚合 ${chart.aggregator}`} />
          <InfoPill label={chart.groupByTag ? `按 ${chart.groupByTag} 拆线` : "单线图"} />
          <InfoPill label={summarizeTagFilters(chart.tagFilters)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">正在加载图表数据…</p>
          </div>
        ) : null}

        {query.isError ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-destructive">数据加载失败：{getErrorMessage(query.error)}</p>
          </div>
        ) : null}

        {!query.isLoading && !query.isError && !hasSeries ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">当前时间范围内没有数据。</p>
          </div>
        ) : null}

        {!query.isLoading && !query.isError && hasSeries && chartData ? (
          <>
            <ChartContainer className="h-72 w-full" config={chartConfig}>
              <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucketLabel" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis
                  width={56}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={value => formatMetricValue(value)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(_label, payload) => {
                        const bucketStart = payload?.[0]?.payload?.bucketStart;
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
                时间范围：{formatFullDateTime(chartData.startAt)} -{" "}
                {formatFullDateTime(chartData.endAt)}
              </p>
              <p>
                序列数：{chartData.series.length} · bucket：{chartData.bucket}
              </p>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeleteMetricChartDialog({
  chart,
  isPending,
  onClose,
  onConfirm,
  errorMessage,
}: {
  chart: MetricChartDefinition | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  errorMessage: string | null;
}) {
  return (
    <Dialog open={chart !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除图表</DialogTitle>
          <DialogDescription>
            {chart
              ? `确认删除图表 ${chart.chartName} 吗？删除后定义会立即消失，但不会删除原始 metric 数据。`
              : "确认删除这张图表吗？"}
          </DialogDescription>
        </DialogHeader>
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "删除中…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border bg-muted px-2.5 py-1 font-medium text-foreground/80">
      {label}
    </span>
  );
}

function buildMetricChartDataQuery(
  chartName: string,
  bucket: MetricChartBucket,
  appliedRange: AppliedRange,
): MetricChartDataQuery {
  return MetricChartDataQuerySchema.parse({
    chartName,
    bucket,
    ...(appliedRange.kind === "preset"
      ? { rangePreset: appliedRange.rangePreset }
      : { startAt: appliedRange.startAt, endAt: appliedRange.endAt }),
  });
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

function summarizeTagFilters(tagFilters: MetricChartDefinition["tagFilters"]): string {
  if (!tagFilters || Object.keys(tagFilters).length === 0) {
    return "无默认过滤";
  }

  return `过滤 ${Object.entries(tagFilters)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}`;
}

function parseTagFiltersText(value: string): Record<string, string> | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  return MetricChartTagFiltersSchema.parse(parsed);
}

function getDefaultBucketByDuration(durationMs: number): MetricChartBucket {
  if (durationMs <= 60 * 1000) {
    return "10s";
  }

  if (durationMs <= 30 * 60 * 1000) {
    return "1m";
  }

  if (durationMs <= 3 * 60 * 60 * 1000) {
    return "5m";
  }

  if (durationMs <= 12 * 60 * 60 * 1000) {
    return "30m";
  }

  return "1h";
}

function getDefaultCustomRangeInputs(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);

  return {
    start: isoToLocalDateTime(start.toISOString()),
    end: isoToLocalDateTime(end.toISOString()),
  };
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

function getErrorMessage(error: unknown): string {
  return getApiErrorMessage(error);
}
