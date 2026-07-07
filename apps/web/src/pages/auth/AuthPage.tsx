import {
  type AuthProvider,
  type AuthStatus,
  type AuthStatusResponse,
  type AuthUsageLimitsResponse,
} from "@kagami/llm-api/auth";
import { type ClaudeCodeUsageLimits } from "@kagami/llm-api/claude-code-auth";
import { type CodexUsageLimits } from "@kagami/llm-api/codex-auth";
import { type MetricPointsQueryResponse } from "@kagami/metric-api/points";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatOptionalDateTime } from "@/lib/format";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { authClient, metricClient } from "@/lib/rpc";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

type PrimaryAuthStatus = Exclude<AuthStatus, "refresh_failed">;

// 趋势图数据源已从旧 auth_usage_snapshot 专用管道切到通用 Metric raw 原始点端点（epic #521）：
// 每个 10 分钟采样点照画、不聚合。metric 名 / window tag 值与 apps/llm 打点侧约定一致。
const OAUTH_QUOTA_REMAINING_PERCENT_METRIC = "llm.oauth.quota.remaining_percent";
const WINDOW_TAG = "window";

type TrendRange = "24h" | "7d";

// UI 的 24h / 7d 档映射到 raw 端点的 rangePreset（低频 gauge 无桶聚合，range 上限已放宽到 7 天）。
const TREND_RANGE_TO_PRESET: Record<TrendRange, "1d" | "7d"> = {
  "24h": "1d",
  "7d": "7d",
};

// 页面 provider（codex）对应打点侧的 provider tag（openai-codex）。
function toMetricProviderTag(provider: AuthProvider): string {
  return provider === "codex" ? "openai-codex" : "claude-code";
}

type TrendChartRow = {
  occurredAt: string;
  five_hour: number | null;
  seven_day: number | null;
};

type AuthProviderConfig = {
  key: AuthProvider;
  label: string;
  badge: string;
  title: string;
  actionDescription: string;
  backgroundClassName: string;
  successMessage: string;
  errorMessage: string;
};

/**
 * 用量趋势两条线按语义涂色，跨 provider 统一（DESIGN.md「一块色 = 一种含义」）：
 * 5 小时窗 = 短期配额消耗 → 玫红 --cost（高 token 成本）；7 天窗 = 长期基线 → 正蓝 --llm。
 * 此前按 provider 各配一套（claude-code 红 / codex 绿），把语义原色当成了品牌色。
 */
const TREND_COLORS = {
  fiveHour: "hsl(var(--cost))",
  sevenDay: "hsl(var(--llm))",
} as const;

const providerConfigs: Record<AuthProvider, AuthProviderConfig> = {
  codex: {
    key: "codex",
    label: "Codex",
    badge: "Codex 内置登录",
    title: "管理 Codex 登录状态",
    actionDescription: "首版按单账号设计。登录会跳转到 OpenAI 的授权页，成功后回到当前管理页。",
    backgroundClassName: "bg-background",
    successMessage: "Codex 登录已完成。",
    errorMessage: "Codex 登录失败。",
  },
  "claude-code": {
    key: "claude-code",
    label: "Claude Code",
    badge: "Claude Code 内置登录",
    title: "管理 Claude Code 登录状态",
    actionDescription: "首版按单账号设计。登录会跳转到 Anthropic 的授权页，成功后回到当前管理页。",
    backgroundClassName: "bg-background",
    successMessage: "Claude Code 登录已完成。",
    errorMessage: "Claude Code 登录失败。",
  },
};

const providerOrder: AuthProvider[] = ["claude-code", "codex"];

export function AuthPage() {
  const { provider } = useParams<{ provider?: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [trendRange, setTrendRange] = useState<TrendRange>("24h");
  const providerValue = provider ?? "";
  const providerKey: AuthProvider = isAuthProvider(providerValue) ? providerValue : "claude-code";
  const providerConfig = providerConfigs[providerKey];
  const shouldRedirect = provider !== providerKey;
  const result = searchParams.get("result");
  const message = searchParams.get("message");

  const statusQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.auth.status(providerConfig.key),
      queryFn: () =>
        authClient.getAuthStatus({ params: { provider: providerConfig.key }, input: {} }),
    }),
  });

  const usageLimitsQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.auth.usageLimits(providerConfig.key),
      queryFn: () =>
        authClient.getAuthUsageLimits({ params: { provider: providerConfig.key }, input: {} }),
      // 一次采集/请求抖动不撤卡：保留上次成功数据，配合下方新鲜度提示（epic #521 卡片韧性）。
      keepPrevious: true,
    }),
  });
  const usageTrendQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.metricPoints.data({
        metric: OAUTH_QUOTA_REMAINING_PERCENT_METRIC,
        provider: providerConfig.key,
        range: trendRange,
      }),
      queryFn: () =>
        metricClient.points({
          metricName: OAUTH_QUOTA_REMAINING_PERCENT_METRIC,
          tagFilters: {
            provider: { op: "eq", value: toMetricProviderTag(providerConfig.key) },
          },
          groupByTag: WINDOW_TAG,
          rangePreset: TREND_RANGE_TO_PRESET[trendRange],
        }),
    }),
  });

  const loginMutation = useMutation({
    mutationFn: () =>
      authClient.createAuthLoginUrl({ params: { provider: providerConfig.key }, input: {} }),
    onSuccess: data => {
      window.location.assign(data.loginUrl);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      authClient.authRefresh({ params: { provider: providerConfig.key }, input: {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.provider(providerConfig.key),
      });
      // 趋势图已迁到 metric-points key（不再挂 auth 前缀），手动刷新后一并让它 refetch（保持旧端点
      // 时「刷新即刷趋势」的行为一致）。
      await queryClient.invalidateQueries({ queryKey: ["metric-points"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await authClient.authLogout({ params: { provider: providerConfig.key }, input: {} });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.provider(providerConfig.key),
      });
    },
  });

  const statusTone = useMemo(() => {
    const status = getPrimaryStatus(statusQuery.data);
    if (status === "active") {
      return "success";
    }
    if (status === "expired") {
      return "warning";
    }
    return "neutral";
  }, [statusQuery.data]);

  const statusData = statusQuery.data ?? null;
  const primaryStatus = getPrimaryStatus(statusData);
  const warningMessage = getStatusWarningMessage(statusData);

  // keepPreviousData 会在切 provider（新 query key）时先返回上一个 provider 的额度；按 provider 过滤，
  // 避免 Codex 页短暂显示 Claude 的额度面板。切换途中无匹配数据即视为加载中。
  const usageLimitsData =
    usageLimitsQuery.data?.provider === providerConfig.key ? usageLimitsQuery.data : undefined;
  const usageLimitsLoading =
    usageLimitsQuery.isLoading || (usageLimitsQuery.isFetching && !usageLimitsData);

  if (shouldRedirect) {
    return <Navigate to="/auth/claude-code" replace />;
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-auto p-3 md:p-6 ${providerConfig.backgroundClassName}`}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <section className="rounded-none border border-border bg-card p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-none border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  {providerConfig.badge}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    {providerConfig.title}
                  </h1>
                </div>
              </div>

              <StatusChip status={primaryStatus} tone={statusTone} />
            </div>

            <div className="inline-flex w-full flex-wrap gap-2 rounded-none border border-border bg-secondary p-1 sm:w-auto">
              {providerOrder.map(item => (
                <NavLink
                  key={item}
                  to={`/auth/${item}`}
                  className={({ isActive }) =>
                    [
                      "inline-flex min-h-11 min-w-[8.5rem] items-center justify-center rounded-none px-4 py-2 text-sm font-medium transition-colors md:min-h-0",
                      isActive
                        ? "bg-card text-foreground"
                        : "text-muted-foreground hover:bg-card hover:text-foreground",
                    ].join(" ")
                  }
                >
                  {providerConfigs[item].label}
                </NavLink>
              ))}
            </div>
          </div>
        </section>

        {result ? (
          <section
            className={`rounded-none border px-4 py-3 text-sm ${
              result === "success"
                ? "border-foreground bg-story text-story-foreground"
                : "border-foreground bg-scheduler text-scheduler-foreground"
            }`}
          >
            {result === "success"
              ? providerConfig.successMessage
              : (message ?? providerConfig.errorMessage)}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-none border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">当前状态</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  来自服务端的活动账号和刷新信息。
                </p>
              </div>
              {statusData?.isLoggedIn ? (
                <ShieldCheck className="h-5 w-5 text-story" />
              ) : (
                <ShieldX className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            {statusQuery.isLoading ? (
              <p className="mt-6 text-sm text-muted-foreground">
                正在读取 {providerConfig.label} 登录状态...
              </p>
            ) : statusQuery.isError ? (
              <p className="mt-6 text-sm text-destructive">{statusQuery.error.message}</p>
            ) : (
              <>
                {warningMessage ? (
                  <p className="mt-6 rounded-none border-2 border-foreground bg-scheduler px-4 py-3 text-sm text-scheduler-foreground">
                    {warningMessage}
                  </p>
                ) : null}
                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <InfoCard label="登录状态" value={toStatusLabel(primaryStatus)} />
                  <InfoCard label="账号 ID" value={statusData!.session?.accountId ?? "未登录"} />
                  <InfoCard label="邮箱" value={statusData!.session?.email ?? "未记录"} />
                  <InfoCard
                    label="Access Token 过期时间"
                    value={formatOptionalDateTime(statusData!.session?.expiresAt, "未记录")}
                  />
                  <InfoCard
                    label="最后刷新时间"
                    value={formatOptionalDateTime(statusData!.session?.lastRefreshAt, "未记录")}
                  />
                  <InfoCard label="最近刷新错误" value={statusData!.session?.lastError ?? "无"} />
                </dl>
              </>
            )}
          </article>

          <article className="rounded-none border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">操作</h2>
            <p className="mt-1 text-sm text-muted-foreground">{providerConfig.actionDescription}</p>

            <div className="mt-6 flex flex-col gap-3">
              <Button
                type="button"
                className="justify-between rounded-none"
                onClick={() => loginMutation.mutate()}
                disabled={loginMutation.isPending}
              >
                <span>{statusData?.isLoggedIn ? "重新登录" : "去登录"}</span>
                <ExternalLink className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                className="justify-between rounded-none"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
              >
                <span>手动刷新</span>
                <RefreshCcw className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                className="justify-between rounded-none border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                <span>登出</span>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-6 space-y-2 text-sm text-muted-foreground">
              {loginMutation.isError ? <p>{loginMutation.error.message}</p> : null}
              {refreshMutation.isError ? <p>{refreshMutation.error.message}</p> : null}
              {logoutMutation.isError ? <p>{logoutMutation.error.message}</p> : null}
            </div>
          </article>
        </section>

        <section className="rounded-none border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">额度</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                展示当前 {providerConfig.label} 登录账号的额度快照。
              </p>
            </div>
          </div>

          {usageLimitsData ? (
            <div className="mt-6 space-y-3">
              <UsageFreshnessLine capturedAt={usageLimitsData.capturedAt} />
              {usageLimitsQuery.isError ? (
                <p className="rounded-none border border-scheduler bg-scheduler/10 px-3 py-2 text-xs text-muted-foreground">
                  最近一次刷新失败，下面展示的是上一次成功的数据。
                </p>
              ) : null}
              <UsageLimitsPanel data={usageLimitsData} />
            </div>
          ) : usageLimitsLoading ? (
            <p className="mt-6 text-sm text-muted-foreground">
              正在读取 {providerConfig.label} 额度...
            </p>
          ) : usageLimitsQuery.isError ? (
            <p className="mt-6 text-sm text-destructive">{usageLimitsQuery.error.message}</p>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">暂无额度信息。</p>
          )}

          <div className="mt-8 border-t border-border pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">剩余额度趋势</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  按分钟采样记录当前账号的 5 小时与 7 天剩余额度变化。
                </p>
              </div>

              <div className="inline-flex w-full flex-wrap gap-2 rounded-none border border-border bg-muted p-1 md:w-auto">
                {(["24h", "7d"] as const).map(range => (
                  <Button
                    key={range}
                    type="button"
                    size="sm"
                    variant={trendRange === range ? "default" : "ghost"}
                    className="rounded-none"
                    onClick={() => setTrendRange(range)}
                  >
                    {range === "24h" ? "24 小时" : "7 天"}
                  </Button>
                ))}
              </div>
            </div>

            {usageTrendQuery.isLoading ? (
              <p className="mt-6 text-sm text-muted-foreground">正在读取趋势数据...</p>
            ) : usageTrendQuery.isError ? (
              <p className="mt-6 text-sm text-destructive">{usageTrendQuery.error.message}</p>
            ) : usageTrendQuery.data ? (
              <div className="mt-6">
                <UsageTrendPanel
                  data={usageTrendQuery.data}
                  providerKey={providerKey}
                  range={trendRange}
                />
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                暂无趋势数据，历史数据会从部署后开始积累。
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function UsageLimitsPanel({ data }: { data: AuthUsageLimitsResponse }) {
  if (data.provider === "claude-code") {
    return <ClaudeUsageLimitsPanel limits={data.limits} />;
  }

  return <CodexUsageLimitsPanel limits={data.limits} />;
}

// 采集周期是 10 分钟；超过 STALE 阈值（错过约 3 个周期）就提示「可能已过期」。
const USAGE_STALE_THRESHOLD_MS = 30 * 60 * 1000;

function UsageFreshnessLine({ capturedAt }: { capturedAt: string | null }) {
  // staleness 依赖当前时间（render 期不能读 Date.now），放 effect 里算，并每分钟自刷。
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!capturedAt) {
      return;
    }
    const capturedMs = new Date(capturedAt).getTime();
    if (Number.isNaN(capturedMs)) {
      return;
    }
    const check = () => setIsStale(Date.now() - capturedMs > USAGE_STALE_THRESHOLD_MS);
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [capturedAt]);

  if (!capturedAt) {
    return null;
  }

  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) {
    return null;
  }

  const label = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(captured);

  return (
    <p className={`text-xs ${isStale ? "font-medium text-foreground" : "text-muted-foreground"}`}>
      更新于 {label}
      {isStale ? " · 数据可能已过期" : ""}
    </p>
  );
}

function ClaudeUsageLimitsPanel({ limits }: { limits: ClaudeCodeUsageLimits }) {
  const items: ReactElement[] = [];

  if (limits.five_hour) {
    items.push(
      <UsageLimitCard
        key="five-hour"
        title="5 小时额度"
        usedPercent={limits.five_hour.utilization}
        secondaryText={buildUsageDetailText({
          usedPercent: limits.five_hour.utilization,
          resetAt: limits.five_hour.resets_at,
        })}
      />,
    );
  }

  if (limits.seven_day) {
    items.push(
      <UsageLimitCard
        key="seven-day"
        title="7 天额度"
        usedPercent={limits.seven_day.utilization}
        secondaryText={buildUsageDetailText({
          usedPercent: limits.seven_day.utilization,
          resetAt: limits.seven_day.resets_at,
        })}
      />,
    );
  }

  if (limits.extra_usage?.is_enabled) {
    items.push(
      <UsageLimitCard
        key="extra-usage"
        title="Extra Usage"
        usedPercent={limits.extra_usage.utilization}
        primaryText={
          limits.extra_usage.utilization === null
            ? "额度已启用"
            : `剩余 ${formatRemainingPercent(limits.extra_usage.utilization)}`
        }
        secondaryText={`已用 ${formatUsdAmount(limits.extra_usage.used_credits)} / ${formatUsdAmount(limits.extra_usage.monthly_limit)}`}
      />,
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无额度信息。</p>;
  }

  return <div className={getUsageGridClassName(items.length)}>{items}</div>;
}

function UsageTrendPanel({
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

function CodexUsageLimitsPanel({ limits }: { limits: CodexUsageLimits }) {
  const items: ReactElement[] = [];

  if (limits.primary) {
    items.push(
      <UsageLimitCard
        key="primary"
        title={`${formatWindowDuration(limits.primary.windowDurationMins)} 窗口`}
        usedPercent={limits.primary.usedPercent}
        secondaryText={buildUsageDetailText({
          usedPercent: limits.primary.usedPercent,
          resetAt: limits.primary.resetsAt,
        })}
      />,
    );
  }

  if (limits.secondary) {
    items.push(
      <UsageLimitCard
        key="secondary"
        title={`${formatWindowDuration(limits.secondary.windowDurationMins)} 窗口`}
        usedPercent={limits.secondary.usedPercent}
        secondaryText={buildUsageDetailText({
          usedPercent: limits.secondary.usedPercent,
          resetAt: limits.secondary.resetsAt,
        })}
      />,
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无额度信息。</p>;
  }

  return <div className={getUsageGridClassName(items.length)}>{items}</div>;
}

function UsageLimitCard({
  title,
  usedPercent,
  primaryText,
  secondaryText,
}: {
  title: string;
  usedPercent: number | null;
  primaryText?: string;
  secondaryText: string;
}) {
  const normalizedPercent = usedPercent === null ? null : clampPercent(usedPercent);
  const displayPrimaryText =
    primaryText ??
    (normalizedPercent === null
      ? "暂无百分比信息"
      : `剩余 ${formatRemainingPercent(normalizedPercent)}`);

  // 额度卡 = 大色块上墙：按用量绿(<50)→黄(50-80)→玫红(≥80)填实，大字 + 白/黑字
  return (
    <article className={`flex flex-col rounded-none p-5 ${getUsageToneClass(normalizedPercent)}`}>
      <div className="font-mono text-xs font-semibold uppercase tracking-wider opacity-80">
        {title}
      </div>
      <p className="mt-3 font-mono text-4xl font-bold leading-none tabular-nums">
        {displayPrimaryText}
      </p>
      <p className="mt-3 text-sm leading-6 opacity-85">{secondaryText}</p>
    </article>
  );
}

function isAuthProvider(value: string): value is AuthProvider {
  return value === "codex" || value === "claude-code";
}

function StatusChip({ status, tone }: { status: string; tone: "success" | "warning" | "neutral" }) {
  const toneClass =
    tone === "success"
      ? "border-foreground bg-story text-story-foreground"
      : tone === "warning"
        ? "border-foreground bg-scheduler text-scheduler-foreground"
        : "border-border bg-muted text-muted-foreground";

  return (
    <div
      className={`inline-flex items-center rounded-none border px-3 py-1 text-sm font-medium ${toneClass}`}
    >
      {toStatusLabel(status)}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-none border border-border bg-muted p-4">
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 break-all text-sm text-foreground">{value}</dd>
    </div>
  );
}

function toStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "已登录";
    case "expired":
      return "已过期";
    case "refresh_failed":
      return "已登录";
    case "logged_out":
      return "已登出";
    default:
      return "不可用";
  }
}

function getPrimaryStatus(statusData: AuthStatusResponse | null | undefined): PrimaryAuthStatus {
  const status = statusData?.status;
  if (!statusData || !status) {
    return "unavailable";
  }

  if (status !== "refresh_failed") {
    return status;
  }

  if (!statusData.session?.expiresAt) {
    return "unavailable";
  }

  const expiresAt = new Date(statusData.session.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return "unavailable";
  }

  return expiresAt.getTime() <= Date.now() ? "expired" : "active";
}

function getStatusWarningMessage(statusData: AuthStatusResponse | null | undefined): string | null {
  if (!statusData?.session?.lastError) {
    return null;
  }

  const primaryStatus = getPrimaryStatus(statusData);
  if (primaryStatus !== "active" && primaryStatus !== "expired") {
    return null;
  }

  if (primaryStatus === "active") {
    return `最近一次后台刷新失败，但当前登录仍可用：${statusData.session.lastError}`;
  }

  return `最近一次后台刷新失败，当前 Access Token 已过期：${statusData.session.lastError}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(value, 100));
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatRemainingPercent(value: number): string {
  return formatPercent(100 - clampPercent(value));
}

function buildUsageDetailText(input: {
  usedPercent: number;
  resetAt: number | string | null;
}): string {
  const parts = [`已用 ${formatPercent(clampPercent(input.usedPercent))}`];
  const resetText = formatResetAt(input.resetAt);
  if (resetText) {
    parts.push(`重置时间 ${resetText}`);
  }
  return parts.join(" · ");
}

function formatResetAt(value: number | string | null): string | null {
  if (value === null) {
    return null;
  }

  const date =
    typeof value === "number"
      ? new Date(value < 10_000_000_000 ? value * 1000 : value)
      : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatWindowDuration(minutes: number): string {
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
    return `${minutes / (24 * 60)} 天`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} 小时`;
  }

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} 小时 ${remainingMinutes} 分钟`;
  }

  return `${minutes} 分钟`;
}

function formatUsdAmount(value: number | null): string {
  if (value === null) {
    return "未知";
  }

  return `$${value.toFixed(2)}`;
}

function getUsageGridClassName(itemCount: number): string {
  if (itemCount >= 3) {
    return "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
  }

  return "grid gap-4 md:grid-cols-2";
}

function getUsageToneClass(usedPercent: number | null): string {
  if (usedPercent === null) {
    return "border-2 border-foreground bg-secondary text-foreground";
  }

  if (usedPercent >= 80) {
    return "border-2 border-foreground bg-cost text-cost-foreground";
  }

  if (usedPercent >= 50) {
    return "border-2 border-foreground bg-scheduler text-scheduler-foreground";
  }

  return "border-2 border-foreground bg-story text-story-foreground";
}

function buildTrendChartData(data: MetricPointsQueryResponse): TrendChartRow[] {
  const rows = new Map<string, TrendChartRow>();

  for (const series of data.series) {
    // groupByTag=window，series.key 是 window tag 值；只认已知的两个窗口。
    const windowKey = series.key === "five_hour" || series.key === "seven_day" ? series.key : null;
    if (!windowKey) {
      continue;
    }

    for (const point of series.points) {
      const existing =
        rows.get(point.occurredAt) ??
        ({
          occurredAt: point.occurredAt,
          five_hour: null,
          seven_day: null,
        } satisfies TrendChartRow);

      existing[windowKey] = point.value;
      rows.set(point.occurredAt, existing);
    }
  }

  return [...rows.values()].sort(
    (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
  );
}

function formatTrendAxisTick(value: string, range: TrendRange): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    ...(range === "24h"
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
        }),
  }).format(date);
}

function formatTrendTooltipLabel(value: string, range: TrendRange): string {
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
    ...(range === "7d" ? {} : { second: "2-digit" }),
  }).format(date);
}

function getTrendWindowLabel(value: string): string {
  if (value === "five_hour") {
    return "5 小时";
  }

  if (value === "seven_day") {
    return "7 天";
  }

  return value;
}
