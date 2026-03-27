import { describe, expect, it, vi } from "vitest";
import type { AuthUsageSnapshotDao } from "../../src/dao/auth-usage-snapshot.dao.js";
import { DefaultAuthUsageTrendQueryService } from "../../src/service/auth-usage-trend-query.impl.service.js";

describe("DefaultAuthUsageTrendQueryService", () => {
  it("should return empty series when account id is missing", async () => {
    const authUsageSnapshotDao: AuthUsageSnapshotDao = {
      insertBatch: vi.fn(),
      listByRange: vi.fn(),
    };
    const service = new DefaultAuthUsageTrendQueryService({
      authUsageSnapshotDao,
    });

    await expect(
      service.query({
        provider: "openai-codex",
        accountId: null,
        range: "24h",
      }),
    ).resolves.toEqual({
      range: "24h",
      series: [
        {
          windowKey: "five_hour",
          label: "5 小时",
          points: [],
        },
        {
          windowKey: "seven_day",
          label: "7 天",
          points: [],
        },
      ],
    });
    expect(authUsageSnapshotDao.listByRange).not.toHaveBeenCalled();
  });

  it("should downsample 7d points to the latest point in each hour bucket", async () => {
    const authUsageSnapshotDao: AuthUsageSnapshotDao = {
      insertBatch: vi.fn(),
      listByRange: vi.fn().mockResolvedValue([
        {
          id: 1,
          provider: "openai-codex",
          accountId: "acct_123",
          windowKey: "five_hour",
          remainingPercent: 79,
          resetAt: null,
          capturedAt: new Date("2026-03-27T10:05:00.000Z"),
        },
        {
          id: 2,
          provider: "openai-codex",
          accountId: "acct_123",
          windowKey: "five_hour",
          remainingPercent: 74,
          resetAt: null,
          capturedAt: new Date("2026-03-27T10:50:00.000Z"),
        },
        {
          id: 3,
          provider: "openai-codex",
          accountId: "acct_123",
          windowKey: "seven_day",
          remainingPercent: 37,
          resetAt: null,
          capturedAt: new Date("2026-03-27T11:15:00.000Z"),
        },
        {
          id: 4,
          provider: "openai-codex",
          accountId: "acct_123",
          windowKey: "seven_day",
          remainingPercent: 34,
          resetAt: null,
          capturedAt: new Date("2026-03-27T11:45:00.000Z"),
        },
      ]),
    };
    const service = new DefaultAuthUsageTrendQueryService({
      authUsageSnapshotDao,
    });

    await expect(
      service.query({
        provider: "openai-codex",
        accountId: "acct_123",
        range: "7d",
      }),
    ).resolves.toEqual({
      range: "7d",
      series: [
        {
          windowKey: "five_hour",
          label: "5 小时",
          points: [
            {
              capturedAt: "2026-03-27T10:50:00.000Z",
              remainingPercent: 74,
            },
          ],
        },
        {
          windowKey: "seven_day",
          label: "7 天",
          points: [
            {
              capturedAt: "2026-03-27T11:45:00.000Z",
              remainingPercent: 34,
            },
          ],
        },
      ],
    });
  });
});
