import { describe, expect, it, vi } from "vitest";
import { LOG_RETENTION_DAYS, pruneAppLogs } from "../src/application/log-prune.js";

function makeDao(deleted: number) {
  const deleteOlderThan = vi.fn().mockResolvedValue(deleted);
  return {
    logDao: {
      insertBatch: vi.fn(),
      countByQuery: vi.fn(),
      listByQueryPage: vi.fn(),
      deleteOlderThan,
    },
    deleteOlderThan,
  };
}

describe("pruneAppLogs", () => {
  it("阈值 = now - 保留天数（默认 7 天）", async () => {
    const { logDao, deleteOlderThan } = makeDao(3);

    const deleted = await pruneAppLogs({ logDao, now: new Date("2026-07-29T12:00:00.000Z") });

    expect(LOG_RETENTION_DAYS).toBe(7);
    expect(deleted).toBe(3);
    expect(deleteOlderThan).toHaveBeenCalledWith(new Date("2026-07-22T12:00:00.000Z"));
  });

  it("保留天数可覆盖", async () => {
    const { logDao, deleteOlderThan } = makeDao(0);

    await pruneAppLogs({ logDao, retentionDays: 1, now: new Date("2026-07-29T00:00:00.000Z") });

    expect(deleteOlderThan).toHaveBeenCalledWith(new Date("2026-07-28T00:00:00.000Z"));
  });

  it("窗口内没有过期行时返回 0，不做别的动作", async () => {
    const { logDao, deleteOlderThan } = makeDao(0);

    const deleted = await pruneAppLogs({ logDao, now: new Date("2026-07-29T00:00:00.000Z") });

    expect(deleted).toBe(0);
    expect(deleteOlderThan).toHaveBeenCalledTimes(1);
  });
});
