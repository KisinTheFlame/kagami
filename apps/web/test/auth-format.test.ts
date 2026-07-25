import { describe, expect, it } from "vitest";
import {
  buildUsageDetailText,
  formatRemainingPercent,
  formatUsdAmount,
  formatWindowDuration,
  getPrimaryStatus,
  getStatusWarningMessage,
  getUsageToneClass,
  isAuthProvider,
} from "@/pages/auth/auth-format";
import { buildTrendChartData, getTrendWindowLabel } from "@/pages/auth/trend-chart-data";
import type { AuthStatusResponse } from "@kagami/llm-api/auth";
import type { MetricPointsQueryResponse } from "@kagami/metric-api/points";

function statusResponse(input: {
  status: AuthStatusResponse["status"];
  expiresAt?: string;
  lastError?: string;
}): AuthStatusResponse {
  return {
    provider: "claude-code",
    isLoggedIn: input.status === "active",
    status: input.status,
    session: {
      accountId: "acc-1",
      email: null,
      expiresAt: input.expiresAt ?? null,
      lastRefreshAt: null,
      lastError: input.lastError ?? null,
    },
  } as AuthStatusResponse;
}

describe("isAuthProvider", () => {
  it("只认已知的两个 provider", () => {
    expect(isAuthProvider("codex")).toBe(true);
    expect(isAuthProvider("claude-code")).toBe(true);
    expect(isAuthProvider("openai")).toBe(false);
    expect(isAuthProvider("")).toBe(false);
  });
});

describe("getPrimaryStatus", () => {
  it("无数据视作不可用", () => {
    expect(getPrimaryStatus(null)).toBe("unavailable");
    expect(getPrimaryStatus(undefined)).toBe("unavailable");
  });

  it("非 refresh_failed 状态原样透传", () => {
    expect(getPrimaryStatus(statusResponse({ status: "active" }))).toBe("active");
    expect(getPrimaryStatus(statusResponse({ status: "logged_out" }))).toBe("logged_out");
  });

  it("refresh_failed 按 token 是否过期归一：未过期仍算已登录", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(getPrimaryStatus(statusResponse({ status: "refresh_failed", expiresAt: future }))).toBe(
      "active",
    );
  });

  it("refresh_failed 且 token 已过期 → expired", () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(getPrimaryStatus(statusResponse({ status: "refresh_failed", expiresAt: past }))).toBe(
      "expired",
    );
  });

  it("refresh_failed 但缺 / 坏 expiresAt → unavailable", () => {
    expect(getPrimaryStatus(statusResponse({ status: "refresh_failed" }))).toBe("unavailable");
    expect(
      getPrimaryStatus(statusResponse({ status: "refresh_failed", expiresAt: "不是时间" })),
    ).toBe("unavailable");
  });
});

describe("getStatusWarningMessage", () => {
  it("没有 lastError 时不提示", () => {
    expect(getStatusWarningMessage(statusResponse({ status: "active" }))).toBeNull();
  });

  it("仍可用时提示「仍可用」", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const message = getStatusWarningMessage(
      statusResponse({ status: "refresh_failed", expiresAt: future, lastError: "boom" }),
    );
    expect(message).toContain("仍可用");
    expect(message).toContain("boom");
  });

  it("已过期时提示「已过期」", () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(
      getStatusWarningMessage(
        statusResponse({ status: "refresh_failed", expiresAt: past, lastError: "boom" }),
      ),
    ).toContain("已过期");
  });
});

describe("百分比与金额格式化", () => {
  it("剩余百分比 = 100 - 已用，且钳制在 0-100", () => {
    expect(formatRemainingPercent(30)).toBe("70%");
    expect(formatRemainingPercent(0)).toBe("100%");
    expect(formatRemainingPercent(120)).toBe("0%");
    expect(formatRemainingPercent(-5)).toBe("100%");
  });

  it("金额缺失回「未知」", () => {
    expect(formatUsdAmount(null)).toBe("未知");
    expect(formatUsdAmount(12.5)).toBe("$12.50");
  });

  it("用量明细在没有重置时间时只给已用", () => {
    expect(buildUsageDetailText({ usedPercent: 42, resetAt: null })).toBe("已用 42%");
  });

  it("用量明细带上可解析的重置时间", () => {
    const text = buildUsageDetailText({ usedPercent: 42, resetAt: "2026-07-25T10:00:00.000Z" });
    expect(text).toContain("已用 42%");
    expect(text).toContain("重置时间");
  });
});

describe("formatWindowDuration", () => {
  it("整天 / 整小时 / 混合 / 分钟各自成句", () => {
    expect(formatWindowDuration(7 * 24 * 60)).toBe("7 天");
    expect(formatWindowDuration(5 * 60)).toBe("5 小时");
    expect(formatWindowDuration(90)).toBe("1 小时 30 分钟");
    expect(formatWindowDuration(30)).toBe("30 分钟");
  });
});

describe("getUsageToneClass", () => {
  it("按用量分档上色：<50 绿 / 50-80 黄 / ≥80 玫红 / 未知中性", () => {
    expect(getUsageToneClass(10)).toContain("bg-story");
    expect(getUsageToneClass(60)).toContain("bg-scheduler");
    expect(getUsageToneClass(95)).toContain("bg-cost");
    expect(getUsageToneClass(null)).toContain("bg-secondary");
  });
});

describe("buildTrendChartData", () => {
  it("同一时刻的两个窗口并成一行，并按时间升序", () => {
    const data = {
      series: [
        {
          key: "five_hour",
          points: [
            { occurredAt: "2026-07-25T02:00:00.000Z", value: 40 },
            { occurredAt: "2026-07-25T01:00:00.000Z", value: 50 },
          ],
        },
        {
          key: "seven_day",
          points: [{ occurredAt: "2026-07-25T01:00:00.000Z", value: 80 }],
        },
      ],
    } as MetricPointsQueryResponse;

    expect(buildTrendChartData(data)).toEqual([
      { occurredAt: "2026-07-25T01:00:00.000Z", five_hour: 50, seven_day: 80 },
      { occurredAt: "2026-07-25T02:00:00.000Z", five_hour: 40, seven_day: null },
    ]);
  });

  it("忽略未知 window tag 的 series", () => {
    const data = {
      series: [
        { key: "one_minute", points: [{ occurredAt: "2026-07-25T01:00:00.000Z", value: 1 }] },
      ],
    } as MetricPointsQueryResponse;

    expect(buildTrendChartData(data)).toEqual([]);
  });
});

describe("getTrendWindowLabel", () => {
  it("已知窗口给中文名，未知原样回", () => {
    expect(getTrendWindowLabel("five_hour")).toBe("5 小时");
    expect(getTrendWindowLabel("seven_day")).toBe("7 天");
    expect(getTrendWindowLabel("weird")).toBe("weird");
  });
});
