import {
  AuthLoginUrlResponseSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthUsageLimitsResponseSchema,
  type AuthProvider,
  type AuthStatus,
  type AuthStatusResponse,
  type AuthUsageLimitsResponse,
} from "@kagami/shared/schemas/auth";
import {
  AuthUsageTrendResponseSchema,
  type AuthUsageTrendRange,
  type AuthUsageTrendResponse,
} from "@kagami/shared/schemas/auth-usage-trend";
import { type ClaudeCodeUsageLimits } from "@kagami/shared/schemas/claude-code-auth";
import { type CodexUsageLimits } from "@kagami/shared/schemas/codex-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
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
import { apiPost, apiPostWithSchema } from "@/lib/api";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

type PrimaryAuthStatus = Exclude<AuthStatus, "refresh_failed">;

type AuthUsageTrendData = AuthUsageTrendResponse;

type TrendChartRow = {
  capturedAt: string;
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
  trendColors: {
    fiveHour: string;
    sevenDay: string;
  };
};

const providerConfigs: Record<AuthProvider, AuthProviderConfig> = {
  codex: {
    key: "codex",
    label: "Codex",
    badge: "Codex 内置登录",
    title: "管理 Codex 登录状态",
    actionDescription: "首版按单账号设计。登录会跳转到 OpenAI 的授权页，成功后回到当前管理页。",
    backgroundClassName:
      "bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.10),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.88))]",
    successMessage: "Codex 登录已完成。",
    errorMessage: "Codex 登录失败。",
    trendColors: {
      fiveHour: "#16a34a",
      sevenDay: "#2563eb",
    },
  },
  "claude-code": {
    key: "claude-code",
    label: "Claude Code",
    badge: "Claude Code 内置登录",
    title: "管理 Claude Code 登录状态",
    actionDescription: "首版按单账号设计。登录会跳转到 Anthropic 的授权页，成功后回到当前管理页。",
    backgroundClassName:
      "bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.12),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.88))]",
    successMessage: "Claude Code 登录已完成。",
    errorMessage: "Claude Code 登录失败。",
    trendColors: {
      fiveHour: "#f59e0b",
      sevenDay: "#0ea5e9",
    },
  },
};

const providerOrder: AuthProvider[] = ["codex", "claude-code"];

export function AuthPage() {
  const { provider } = useParams<{ provider?: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [trendRange, setTrendRange] = useState<AuthUsageTrendRange>("24h");
  const providerValue = provider ?? "";
  const providerKey: AuthProvider = isAuthProvider(providerValue) ? providerValue : "codex";
  const providerConfig = providerConfigs[providerKey];
  const shouldRedirect = provider !== providerKey;
  const result = searchParams.get("result");
  const message = searchParams.get("message");

  const statusQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.auth.status(providerConfig.key),
      path: buildAuthEndpoint(providerConfig.key, "status"),
      schema: AuthStatusResponseSchema,
    }),
  });

  const usageLimitsQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.auth.usageLimits(providerConfig.key),
      path: buildAuthEndpoint(providerConfig.key, "usage-limits"),
      schema: AuthUsageLimitsResponseSchema,
    }),
  });
  const usageTrendQuery = useQuery({
    ...createSchemaQueryOptions({
      queryKey: queryKeys.auth.usageTrend(providerConfig.key, trendRange),
      path: buildAuthEndpoint(providerConfig.key, "usage-trend"),
      schema: AuthUsageTrendResponseSchema,
      params: {
        range: trendRange,
      },
    }),
  });

  const loginMutation = useMutation({
    mutationFn: async () => {
      return apiPostWithSchema(
        buildAuthEndpoint(providerConfig.key, "login-url"),
        {},
        AuthLoginUrlResponseSchema,
      );
    },
    onSuccess: data => {
      window.location.assign(data.loginUrl);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () =>
      apiPostWithSchema(buildAuthEndpoint(providerConfig.key, "refresh"), {}, AuthRefreshResponseSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.provider(providerConfig.key),
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiPost(buildAuthEndpoint(providerConfig.key, "logout"), {});
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

  if (shouldRedirect) {
    return <Navigate to="/auth/codex" replace />;
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-auto p-3 md:p-6 ${providerConfig.backgroundClassName}`}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  <KeyRound className="h-3.5 w-3.5" />
                  {providerConfig.badge}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {providerConfig.title}
                  </h1>
                </div>
              </div>

              <StatusChip status={primaryStatus} tone={statusTone} />
            </div>

            <div className="inline-flex w-full flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-100/80 p-1 sm:w-auto">
              {providerOrder.map(item => (
                <NavLink
                  key={item}
                  to={`/auth/${item}`}
                  className={({ isActive }) =>
                    [
                      "inline-flex min-w-[8.5rem] items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
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
            className={`rounded-2xl border px-4 py-3 text-sm ${
              result === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {result === "success"
              ? providerConfig.successMessage
              : (message ?? providerConfig.errorMessage)}
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">当前状态</h2>
                <p className="mt-1 text-sm text-slate-500">来自服务端的活动账号和刷新信息。</p>
              </div>
              {statusData?.isLoggedIn ? (
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              ) : (
                <ShieldX className="h-5 w-5 text-slate-400" />
              )}
            </div>

            {statusQuery.isLoading ? (
              <p className="mt-6 text-sm text-slate-500">
                正在读取 {providerConfig.label} 登录状态...
              </p>
            ) : statusQuery.isError ? (
              <p className="mt-6 text-sm text-rose-600">{statusQuery.error.message}</p>
            ) : (
              <>
                {warningMessage ? (
                  <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {warningMessage}
                  </p>
                ) : null}
                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <InfoCard label="登录状态" value={toStatusLabel(primaryStatus)} />
                  <InfoCard label="账号 ID" value={statusData!.session?.accountId ?? "未登录"} />
                  <InfoCard label="邮箱" value={statusData!.session?.email ?? "未记录"} />
                  <InfoCard
                    label="Access Token 过期时间"
                    value={formatDateTime(statusData!.session?.expiresAt)}
                  />
                  <InfoCard
                    label="最后刷新时间"
                    value={formatDateTime(statusData!.session?.lastRefreshAt)}
                  />
                  <InfoCard label="最近刷新错误" value={statusData!.session?.lastError ?? "无"} />
                </dl>
              </>
            )}
          </article>

          <article className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">操作</h2>
            <p className="mt-1 text-sm text-slate-500">{providerConfig.actionDescription}</p>

            <div className="mt-6 flex flex-col gap-3">
              <Button
                type="button"
                className="justify-between rounded-2xl"
                onClick={() => loginMutation.mutate()}
                disabled={loginMutation.isPending}
              >
                <span>{statusData?.isLoggedIn ? "重新登录" : "去登录"}</span>
                <ExternalLink className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                className="justify-between rounded-2xl"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
              >
                <span>手动刷新</span>
                <RefreshCcw className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                className="justify-between rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                <span>登出</span>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-6 space-y-2 text-sm text-slate-500">
              {loginMutation.isError ? <p>{loginMutation.error.message}</p> : null}
              {refreshMutation.isError ? <p>{refreshMutation.error.message}</p> : null}
              {logoutMutation.isError ? <p>{logoutMutation.error.message}</p> : null}
            </div>
          </article>
        </section>

        <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">额度</h2>
              <p className="mt-1 text-sm text-slate-500">
                展示当前 {providerConfig.label} 登录账号的额度快照。
              </p>
            </div>
          </div>

          {usageLimitsQuery.isLoading ? (
            <p className="mt-6 text-sm text-slate-500">正在读取 {providerConfig.label} 额度...</p>
          ) : usageLimitsQuery.isError ? (
            <p className="mt-6 text-sm text-rose-600">{usageLimitsQuery.error.message}</p>
          ) : usageLimitsQuery.data ? (
            <div className="mt-6">
              <UsageLimitsPanel data={usageLimitsQuery.data} />
            </div>
          ) : (
            <p className="mt-6 text-sm text-slate-500">暂无额度信息。</p>
          )}

          <div className="mt-8 border-t border-slate-200/80 pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">剩余额度趋势</h3>
                <p className="mt-1 text-sm text-slate-500">
                  按分钟采样记录当前账号的 5 小时与 7 天剩余额度变化。
                </p>
              </div>

              <div className="inline-flex w-full flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-1 md:w-auto">
                {(["24h", "7d"] as const).map(range => (
                  <Button
                    key={range}
                    type="button"
                    size="sm"
                    variant={trendRange === range ? "default" : "ghost"}
                    className="rounded-xl"
                    onClick={() => setTrendRange(range)}
                  >
                    {range === "24h" ? "24 小时" : "7 天"}
                  </Button>
                ))}
              </div>
            </div>

            {usageTrendQuery.isLoading ? (
              <p className="mt-6 text-sm text-slate-500">正在读取趋势数据...</p>
            ) : usageTrendQuery.isError ? (
              <p className="mt-6 text-sm text-rose-600">{usageTrendQuery.error.message}</p>
            ) : usageTrendQuery.data ? (
              <div className="mt-6">
                <UsageTrendPanel
                  data={usageTrendQuery.data}
                  providerConfig={providerConfig}
                  providerKey={providerKey}
                />
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-500">
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
    return <p className="text-sm text-slate-500">暂无额度信息。</p>;
  }

  return <div className={getUsageGridClassName(items.length)}>{items}</div>;
}

function UsageTrendPanel({
  data,
  providerConfig,
  providerKey,
}: {
  data: AuthUsageTrendData;
  providerConfig: AuthProviderConfig;
  providerKey: AuthProvider;
}) {
  const chartData = useMemo(() => buildTrendChartData(data), [data]);
  const hasPoints = chartData.some(item => item.five_hour !== null || item.seven_day !== null);
  const chartConfig = useMemo(
    () =>
      ({
        five_hour: {
          label: "5 小时",
          color: providerConfig.trendColors.fiveHour,
        },
        seven_day: {
          label: "7 天",
          color: providerConfig.trendColors.sevenDay,
        },
      }) satisfies ChartConfig,
    [providerConfig.trendColors.fiveHour, providerConfig.trendColors.sevenDay],
  );

  if (!hasPoints) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
        暂无趋势数据，历史数据会从部署后开始积累。
      </p>
    );
  }

  const gradientPrefix = `usage-trend-${providerKey}`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:p-5">
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
            dataKey="capturedAt"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickFormatter={value => formatTrendAxisTick(value, data.range)}
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
                labelFormatter={value => formatTrendTooltipLabel(String(value), data.range)}
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
            type="monotone"
            dataKey="five_hour"
            stroke="var(--color-five_hour)"
            fill={`url(#${gradientPrefix}-five-hour)`}
            strokeWidth={2}
            connectNulls
          />
          <Area
            type="monotone"
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
    return <p className="text-sm text-slate-500">暂无额度信息。</p>;
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
  const remainingPercent =
    normalizedPercent === null ? null : clampPercent(100 - normalizedPercent);
  const displayPrimaryText =
    primaryText ??
    (normalizedPercent === null
      ? "暂无百分比信息"
      : `剩余 ${formatRemainingPercent(normalizedPercent)}`);

  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            {displayPrimaryText}
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getUsageToneClass(normalizedPercent)}`}
        >
          {normalizedPercent === null ? "未知" : `已用 ${formatPercent(normalizedPercent)}`}
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-[width] ${getUsageBarClass(normalizedPercent)}`}
          style={{
            width: `${remainingPercent ?? 0}%`,
          }}
        />
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600">{secondaryText}</p>
    </article>
  );
}

function isAuthProvider(value: string): value is AuthProvider {
  return value === "codex" || value === "claude-code";
}

function buildAuthEndpoint(
  provider: AuthProvider,
  action: "status" | "login-url" | "logout" | "refresh" | "usage-limits" | "usage-trend",
): string {
  return `/auth/${provider}/${action}`;
}

function StatusChip({ status, tone }: { status: string; tone: "success" | "warning" | "neutral" }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${toneClass}`}
    >
      {toStatusLabel(status)}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="mt-2 break-all text-sm text-slate-900">{value}</dd>
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "未记录";
  }

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

function getUsageBarClass(usedPercent: number | null): string {
  if (usedPercent === null) {
    return "bg-slate-300";
  }

  if (usedPercent >= 80) {
    return "bg-rose-500";
  }

  if (usedPercent >= 50) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
}

function getUsageToneClass(usedPercent: number | null): string {
  if (usedPercent === null) {
    return "bg-slate-100 text-slate-600";
  }

  if (usedPercent >= 80) {
    return "bg-rose-100 text-rose-700";
  }

  if (usedPercent >= 50) {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-emerald-100 text-emerald-700";
}

function buildTrendChartData(data: AuthUsageTrendData): TrendChartRow[] {
  const rows = new Map<string, TrendChartRow>();

  for (const series of data.series) {
    for (const point of series.points) {
      const existing =
        rows.get(point.capturedAt) ??
        ({
          capturedAt: point.capturedAt,
          five_hour: null,
          seven_day: null,
        } satisfies TrendChartRow);

      existing[series.windowKey] = point.remainingPercent;
      rows.set(point.capturedAt, existing);
    }
  }

  return [...rows.values()].sort(
    (left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime(),
  );
}

function formatTrendAxisTick(value: string, range: AuthUsageTrendRange): string {
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

function formatTrendTooltipLabel(value: string, range: AuthUsageTrendRange): string {
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
