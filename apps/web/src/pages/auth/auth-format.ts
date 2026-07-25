import { type AuthProvider, type AuthStatus, type AuthStatusResponse } from "@kagami/llm-api/auth";

/** 对外展示用的登录状态：refresh_failed 会被归一到 active / expired / unavailable。 */
export type PrimaryAuthStatus = Exclude<AuthStatus, "refresh_failed">;

export function isAuthProvider(value: string): value is AuthProvider {
  return value === "codex" || value === "claude-code";
}

export function toStatusLabel(status: string): string {
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

export function getPrimaryStatus(
  statusData: AuthStatusResponse | null | undefined,
): PrimaryAuthStatus {
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

export function getStatusWarningMessage(
  statusData: AuthStatusResponse | null | undefined,
): string | null {
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

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(value, 100));
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatRemainingPercent(value: number): string {
  return formatPercent(100 - clampPercent(value));
}

export function buildUsageDetailText(input: {
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

export function formatWindowDuration(minutes: number): string {
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

export function formatUsdAmount(value: number | null): string {
  if (value === null) {
    return "未知";
  }

  return `$${value.toFixed(2)}`;
}

export function getUsageGridClassName(itemCount: number): string {
  if (itemCount >= 3) {
    return "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
  }

  return "grid gap-4 md:grid-cols-2";
}

export function getUsageToneClass(usedPercent: number | null): string {
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
