import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NapcatEventSubscriber,
  type NapcatCursorStore,
} from "../../src/acl/napcat-event-subscriber.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

/** 永不 resolve 的 fetch：让 connectOnce 在读到响应前一直挂起，便于断言「已发起连接」而不推进后续。 */
function hangingFetch(): typeof fetch {
  return vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;
}

describe("NapcatEventSubscriber — 启动韧性（游标读取失败不静默打死订阅）", () => {
  beforeEach(() => {
    initTestLoggerRuntime();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() 不因游标读取失败而 reject，且持续退避重试加载游标", async () => {
    const load = vi.fn<NapcatCursorStore["load"]>().mockRejectedValue(new Error("app_state down"));
    const cursorStore: NapcatCursorStore = { load, save: vi.fn().mockResolvedValue(undefined) };
    const fetchImpl = hangingFetch();
    const subscriber = new NapcatEventSubscriber({
      baseUrl: "http://napcat",
      onEvent: vi.fn(),
      cursorStore,
      fetch: fetchImpl,
    });

    // 关键：即使游标读取一定失败，start() 也必须 resolve（外层是 void start()，reject 会成 unhandled）。
    await expect(subscriber.start()).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    // 读游标失败 → 未发起 SSE 连接，进入退避重试。
    expect(fetchImpl).not.toHaveBeenCalled();

    // 推进一个退避周期，游标读取被再次重试（订阅没有死）。
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);

    subscriber.stop();
  });

  it("游标读取先失败后成功：不丢订阅，用恢复的 seq 作 Last-Event-ID 连接", async () => {
    const load = vi
      .fn<NapcatCursorStore["load"]>()
      .mockRejectedValueOnce(new Error("app_state down"))
      .mockResolvedValueOnce(42);
    const cursorStore: NapcatCursorStore = { load, save: vi.fn().mockResolvedValue(undefined) };
    const fetchImpl = hangingFetch();
    const subscriber = new NapcatEventSubscriber({
      baseUrl: "http://napcat",
      onEvent: vi.fn(),
      cursorStore,
      fetch: fetchImpl,
    });

    await subscriber.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();

    // 退避后重试：游标读取成功 → 发起 SSE 连接，且带上恢复出来的 seq。
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Last-Event-ID"]).toBe("42");

    subscriber.stop();
  });
});
