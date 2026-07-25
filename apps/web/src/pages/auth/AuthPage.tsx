import { type AuthProvider } from "@kagami/llm-api/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate, NavLink, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatOptionalDateTime } from "@/lib/format";
import { createSchemaQueryOptions, queryKeys } from "@/lib/query";
import { authClient, metricClient } from "@/lib/rpc";
import {
  getPrimaryStatus,
  getStatusWarningMessage,
  isAuthProvider,
  toStatusLabel,
} from "./auth-format";
import {
  OAUTH_QUOTA_REMAINING_PERCENT_METRIC,
  TREND_RANGE_TO_PRESET,
  WINDOW_TAG,
  toMetricProviderTag,
  type TrendRange,
} from "./trend-chart-data";
import { UsageFreshnessLine, UsageLimitsPanel } from "./UsageLimitsPanel";
import { UsageTrendPanel } from "./UsageTrendPanel";

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
