import { type AuthUsageLimitsResponse } from "@kagami/llm-api/auth";
import { type ClaudeCodeUsageLimits } from "@kagami/llm-api/claude-code-auth";
import { type CodexUsageLimits } from "@kagami/llm-api/codex-auth";
import { type ReactElement, useEffect, useState } from "react";
import {
  buildUsageDetailText,
  clampPercent,
  formatRemainingPercent,
  formatUsdAmount,
  formatWindowDuration,
  getUsageGridClassName,
  getUsageToneClass,
} from "./auth-format";

/** 额度快照面板：按 provider 分发到各自的额度卡片组。 */
export function UsageLimitsPanel({ data }: { data: AuthUsageLimitsResponse }) {
  if (data.provider === "claude-code") {
    return <ClaudeUsageLimitsPanel limits={data.limits} />;
  }

  return <CodexUsageLimitsPanel limits={data.limits} />;
}

// 采集周期是 10 分钟；超过 STALE 阈值（错过约 3 个周期）就提示「可能已过期」。
const USAGE_STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function UsageFreshnessLine({ capturedAt }: { capturedAt: string | null }) {
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
