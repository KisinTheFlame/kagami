import {
  ClaudeCodeAuthLoginUrlResponseSchema,
  ClaudeCodeAuthRefreshResponseSchema,
  ClaudeCodeAuthStatusResponseSchema,
  ClaudeCodeUsageLimitsResponseSchema,
  CodexAuthLoginUrlResponseSchema,
  CodexAuthRefreshResponseSchema,
  CodexAuthStatusResponseSchema,
  CodexUsageLimitsResponseSchema,
} from "@kagami/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { Navigate, NavLink, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { apiFetch, apiRequest } from "@/lib/api";

type AuthProvider = "codex" | "claude-code";
type AuthStatus = "active" | "expired" | "refresh_failed" | "logged_out" | "unavailable";

type AuthStatusResponse = {
  status: AuthStatus;
  isLoggedIn: boolean;
  session: {
    accountId: string | null;
    email: string | null;
    expiresAt: string | null;
    lastRefreshAt: string | null;
    lastError: string | null;
  } | null;
};

type AuthUsageLimitsData =
  | {
      provider: "codex";
      limits: ReturnType<typeof CodexUsageLimitsResponseSchema.parse>;
    }
  | {
      provider: "claude-code";
      limits: ReturnType<typeof ClaudeCodeUsageLimitsResponseSchema.parse>;
    };

type AuthProviderConfig = {
  key: AuthProvider;
  label: string;
  badge: string;
  title: string;
  actionDescription: string;
  endpointPrefix: "/codex-auth" | "/claude-code-auth";
  backgroundClassName: string;
  successMessage: string;
  errorMessage: string;
  parseStatusResponse: (value: unknown) => AuthStatusResponse;
  parseLoginUrlResponse: (value: unknown) => { loginUrl: string; expiresAt: string };
  parseRefreshResponse: (value: unknown) => unknown;
  parseUsageLimitsResponse: (value: unknown) => AuthUsageLimitsData;
};

const providerConfigs: Record<AuthProvider, AuthProviderConfig> = {
  codex: {
    key: "codex",
    label: "Codex",
    badge: "Codex 内置登录",
    title: "管理 Codex 登录状态",
    actionDescription: "首版按单账号设计。登录会跳转到 OpenAI 的授权页，成功后回到当前管理页。",
    endpointPrefix: "/codex-auth",
    backgroundClassName:
      "bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.10),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.88))]",
    successMessage: "Codex 登录已完成。",
    errorMessage: "Codex 登录失败。",
    parseStatusResponse: value => {
      const parsed = CodexAuthStatusResponseSchema.parse(value);
      return {
        status: parsed.status,
        isLoggedIn: parsed.isLoggedIn,
        session: parsed.session
          ? {
              accountId: parsed.session.accountId,
              email: parsed.session.email,
              expiresAt: parsed.session.expiresAt,
              lastRefreshAt: parsed.session.lastRefreshAt,
              lastError: parsed.session.lastError,
            }
          : null,
      };
    },
    parseLoginUrlResponse: value => CodexAuthLoginUrlResponseSchema.parse(value),
    parseRefreshResponse: value => CodexAuthRefreshResponseSchema.parse(value),
    parseUsageLimitsResponse: value => ({
      provider: "codex",
      limits: CodexUsageLimitsResponseSchema.parse(value),
    }),
  },
  "claude-code": {
    key: "claude-code",
    label: "Claude Code",
    badge: "Claude Code 内置登录",
    title: "管理 Claude Code 登录状态",
    actionDescription: "首版按单账号设计。登录会跳转到 Anthropic 的授权页，成功后回到当前管理页。",
    endpointPrefix: "/claude-code-auth",
    backgroundClassName:
      "bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.12),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.88))]",
    successMessage: "Claude Code 登录已完成。",
    errorMessage: "Claude Code 登录失败。",
    parseStatusResponse: value => {
      const parsed = ClaudeCodeAuthStatusResponseSchema.parse(value);
      return {
        status: parsed.status,
        isLoggedIn: parsed.isLoggedIn,
        session: parsed.session
          ? {
              accountId: parsed.session.accountId,
              email: parsed.session.email,
              expiresAt: parsed.session.expiresAt,
              lastRefreshAt: parsed.session.lastRefreshAt,
              lastError: parsed.session.lastError,
            }
          : null,
      };
    },
    parseLoginUrlResponse: value => ClaudeCodeAuthLoginUrlResponseSchema.parse(value),
    parseRefreshResponse: value => ClaudeCodeAuthRefreshResponseSchema.parse(value),
    parseUsageLimitsResponse: value => ({
      provider: "claude-code",
      limits: ClaudeCodeUsageLimitsResponseSchema.parse(value),
    }),
  },
};

const providerOrder: AuthProvider[] = ["codex", "claude-code"];

export function AuthPage() {
  const { provider } = useParams<{ provider?: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const providerValue = provider ?? "";
  const providerKey: AuthProvider = isAuthProvider(providerValue) ? providerValue : "codex";
  const providerConfig = providerConfigs[providerKey];
  const shouldRedirect = provider !== providerKey;
  const result = searchParams.get("result");
  const message = searchParams.get("message");

  const statusQuery = useQuery({
    queryKey: ["auth-status", providerConfig.key],
    queryFn: async () => {
      const response = await apiFetch<unknown>(`${providerConfig.endpointPrefix}/status`);
      return providerConfig.parseStatusResponse(response);
    },
  });

  const usageLimitsQuery = useQuery({
    queryKey: ["auth-usage-limits", providerConfig.key],
    queryFn: async () => {
      const response = await apiFetch<unknown>(`${providerConfig.endpointPrefix}/usage-limits`);
      return providerConfig.parseUsageLimitsResponse(response);
    },
  });

  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`${providerConfig.endpointPrefix}/login-url`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response.status, response.statusText));
      }

      return providerConfig.parseLoginUrlResponse(response.body);
    },
    onSuccess: data => {
      window.location.assign(data.loginUrl);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`${providerConfig.endpointPrefix}/refresh`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response.status, response.statusText));
      }

      return providerConfig.parseRefreshResponse(response.body);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["auth-status", providerConfig.key],
        }),
        queryClient.invalidateQueries({
          queryKey: ["auth-usage-limits", providerConfig.key],
        }),
      ]);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`${providerConfig.endpointPrefix}/logout`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response.status, response.statusText));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["auth-status", providerConfig.key],
        }),
        queryClient.invalidateQueries({
          queryKey: ["auth-usage-limits", providerConfig.key],
        }),
      ]);
    },
  });

  const statusTone = useMemo(() => {
    const status = statusQuery.data?.status;
    if (status === "active") {
      return "success";
    }
    if (status === "expired" || status === "refresh_failed") {
      return "warning";
    }
    return "neutral";
  }, [statusQuery.data?.status]);

  const statusData = statusQuery.data ?? null;

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

              <StatusChip status={statusQuery.data?.status ?? "unavailable"} tone={statusTone} />
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
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <InfoCard label="登录状态" value={toStatusLabel(statusData!.status)} />
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
                <InfoCard label="最近错误" value={statusData!.session?.lastError ?? "无"} />
              </dl>
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
        </section>
      </div>
    </div>
  );
}

function UsageLimitsPanel({ data }: { data: AuthUsageLimitsData }) {
  if (data.provider === "claude-code") {
    return <ClaudeUsageLimitsPanel limits={data.limits} />;
  }

  return <CodexUsageLimitsPanel limits={data.limits} />;
}

function ClaudeUsageLimitsPanel({
  limits,
}: {
  limits: ReturnType<typeof ClaudeCodeUsageLimitsResponseSchema.parse>;
}) {
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

function CodexUsageLimitsPanel({
  limits,
}: {
  limits: ReturnType<typeof CodexUsageLimitsResponseSchema.parse>;
}) {
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
      return "刷新失败";
    case "logged_out":
      return "已登出";
    default:
      return "不可用";
  }
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

function formatApiError(status: number, statusText: string): string {
  return `API error ${status}: ${statusText}`;
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
