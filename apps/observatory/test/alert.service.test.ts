import { describe, expect, it, vi } from "vitest";
import type { RaiseAlertRequest } from "@kagami/observatory-api/alert";
import { AlertService } from "../src/application/alert.service.js";
import { AlertThrottle } from "../src/application/alert-throttle.js";
import { initTestLoggerRuntime } from "./helpers/logger.js";

initTestLoggerRuntime();

const ALERT: RaiseAlertRequest = {
  source: "agent",
  event: "react.empty_stall",
  severity: "error",
  title: "连续 4 轮 LLM 返回空内容，已挂起等待下一个事件。",
  context: { emptyStreak: 4, noToolStreak: 4 },
};

/**
 * 告警编排的三条不变量（issue #602）：
 * 1. 永不外抛——投递失败归一成 { delivered: false, suppressed: false }。
 * 2. 被限流时不碰通道。
 * 3. metric 是旁路——打点抛错不影响返回值与投递。
 */
describe("AlertService", () => {
  function makeService(
    options: {
      deliver?: () => Promise<void>;
      metricRecord?: () => Promise<void>;
    } = {},
  ) {
    let nowMs = 1_000_000;
    const deliver = vi.fn<(message: string) => Promise<void>>(options.deliver ?? (async () => {}));
    const record = vi.fn(options.metricRecord ?? (async () => {}));
    const service = new AlertService({
      channel: { deliver },
      throttle: new AlertThrottle({ now: () => new Date(nowMs) }),
      metricService: { record },
      now: () => new Date(nowMs),
    });

    return {
      service,
      deliver,
      record,
      advance: (ms: number) => {
        nowMs += ms;
      },
    };
  }

  it("首条投递成功：回 delivered，通道收到渲染好的文本", async () => {
    const { service, deliver } = makeService();

    await expect(service.raise(ALERT)).resolves.toEqual({ delivered: true, suppressed: false });
    expect(deliver).toHaveBeenCalledTimes(1);
    const message = deliver.mock.calls[0]![0];
    expect(message.split("\n")[0]).toBe("【error】agent · react.empty_stall");
    expect(message).toContain("emptyStreak: 4");
  });

  it("窗口内第二条被压制：回 suppressed 且完全不碰通道", async () => {
    const { service, deliver } = makeService();

    await service.raise(ALERT);
    await expect(service.raise(ALERT)).resolves.toEqual({ delivered: false, suppressed: true });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("窗口过后再投递：文本末行带回被压制次数", async () => {
    const { service, deliver, advance } = makeService();

    await service.raise(ALERT);
    await service.raise(ALERT);
    await service.raise(ALERT);
    advance(300_000);
    await service.raise(ALERT);

    const message = deliver.mock.calls[1]![0];
    expect(message.endsWith("距上次同类告警之间另有 2 次被压制。")).toBe(true);
  });

  it("通道抛错：回 { delivered: false, suppressed: false } 且不外抛", async () => {
    const { service } = makeService({
      deliver: async () => {
        throw new Error("kagami-napcat 不可达，告警投递失败");
      },
    });

    await expect(service.raise(ALERT)).resolves.toEqual({ delivered: false, suppressed: false });
  });

  it("通道抛错后窗口仍算已开：5 分钟内同类告警继续被压制（以尝试为界）", async () => {
    const { service, deliver } = makeService({
      deliver: async () => {
        throw new Error("down");
      },
    });

    await service.raise(ALERT);
    await expect(service.raise(ALERT)).resolves.toEqual({ delivered: false, suppressed: true });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("metric 是旁路：record reject 不影响返回值与投递", async () => {
    const { service, deliver } = makeService({
      metricRecord: async () => {
        throw new Error("metric down");
      },
    });

    await expect(service.raise(ALERT)).resolves.toEqual({ delivered: true, suppressed: false });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("metric 同步抛错（坏 client）也不影响主路径", async () => {
    const nowMs = 1_000_000;
    const deliver = vi.fn(async () => {});
    const service = new AlertService({
      channel: { deliver },
      throttle: new AlertThrottle({ now: () => new Date(nowMs) }),
      metricService: {
        record: () => {
          throw new Error("sync boom");
        },
      },
      now: () => new Date(nowMs),
    });

    await expect(service.raise(ALERT)).resolves.toEqual({ delivered: true, suppressed: false });
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
