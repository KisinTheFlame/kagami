import { beforeAll, describe, expect, it, vi } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { IthomePoller } from "../../src/agent/capabilities/ithome/application/ithome-poller.js";
import type { IthomeService } from "../../src/agent/capabilities/ithome/application/ithome.service.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

function makePoller(input: {
  newArticles: { articleId: number; title: string }[];
  now: () => Date;
  onArticleIngested: (a: { articleId: number; title: string }) => void;
}): IthomePoller {
  const ithomeService = {
    syncFeed: async () => ({ newArticles: input.newArticles }),
  } as unknown as IthomeService;
  return new IthomePoller({
    ithomeService,
    pollIntervalMs: 300_000,
    onArticleIngested: input.onArticleIngested,
    now: input.now,
  });
}

// 03:00 北京时间 = 19:00Z 前一日；11:00 北京时间 = 03:00Z。
const QUIET_INSTANT = new Date("2026-07-05T19:00:00.000Z"); // 次日 03:00 北京时间，落在 [1,9)
const ACTIVE_INSTANT = new Date("2026-07-05T03:00:00.000Z"); // 11:00 北京时间，窗外

describe("IthomePoller quiet hours", () => {
  it("suppresses notifications during the quiet window but still syncs", async () => {
    const onArticleIngested = vi.fn();
    const poller = makePoller({
      newArticles: [{ articleId: 1, title: "深夜新闻" }],
      now: () => QUIET_INSTANT,
      onArticleIngested,
    });

    await poller.runOnce();
    // 文章照常同步（syncFeed 被调），但深夜不敲门。
    expect(onArticleIngested).not.toHaveBeenCalled();
  });

  it("delivers notifications outside the quiet window", async () => {
    const onArticleIngested = vi.fn();
    const poller = makePoller({
      newArticles: [{ articleId: 2, title: "白天新闻" }],
      now: () => ACTIVE_INSTANT,
      onArticleIngested,
    });

    await poller.runOnce();
    expect(onArticleIngested).toHaveBeenCalledTimes(1);
    expect(onArticleIngested).toHaveBeenCalledWith({ articleId: 2, title: "白天新闻" });
  });
});
