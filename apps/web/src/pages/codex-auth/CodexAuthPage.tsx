import {
  CodexAuthLoginUrlResponseSchema,
  CodexAuthRefreshResponseSchema,
  CodexAuthStatusResponseSchema,
} from "@kagami/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogOut, RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { apiFetch, apiRequest } from "@/lib/api";

export function CodexAuthPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const result = searchParams.get("result");
  const message = searchParams.get("message");

  const statusQuery = useQuery({
    queryKey: ["codex-auth-status"],
    queryFn: async () => {
      const response = await apiFetch<unknown>("/codex-auth/status");
      return CodexAuthStatusResponseSchema.parse(response);
    },
  });

  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/codex-auth/login-url", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response.status, response.statusText));
      }

      return CodexAuthLoginUrlResponseSchema.parse(response.body);
    },
    onSuccess: data => {
      window.location.assign(data.loginUrl);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/codex-auth/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response.status, response.statusText));
      }

      return CodexAuthRefreshResponseSchema.parse(response.body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["codex-auth-status"],
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/codex-auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response.status, response.statusText));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["codex-auth-status"],
      });
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

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-auto bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.10),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.12),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.88))] p-3 md:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                <KeyRound className="h-3.5 w-3.5" />
                Codex 内置登录
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  管理 Codex 登录状态
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  这里负责登录、刷新和登出，不承担 LLM 调试功能。当前页面会直接读取服务端维护的
                  Codex 票据状态。
                </p>
              </div>
            </div>

            <StatusChip status={statusQuery.data?.status ?? "unavailable"} tone={statusTone} />
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
            {result === "success" ? "Codex 登录已完成。" : (message ?? "Codex 登录失败。")}
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
              <p className="mt-6 text-sm text-slate-500">正在读取 Codex 登录状态...</p>
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
            <p className="mt-1 text-sm text-slate-500">
              首版按单账号设计。登录会跳转到 OpenAI 的授权页，成功后回到当前管理页。
            </p>

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
      </div>
    </div>
  );
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
