import { describe, expect, it, vi } from "vitest";
import type { NapcatAgentEvent, NapcatOutboxEvent } from "@kagami/napcat-api/event";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import {
  NapcatEventBroadcaster,
  type NapcatEventSubscriber,
} from "../src/application/napcat-event-broadcaster.js";

// safe() 摘除失败订阅者时会 logger.warn；初始化一个空 sink 的 runtime，避免未初始化时抛。
initLoggerRuntime({ sinks: [] });

function outbox(seq: number): NapcatOutboxEvent {
  const event: NapcatAgentEvent = { type: "napcat_friend_list_updated", data: { friends: [] } };
  return { seq, event };
}

/** 记录各回调调用次数的假订阅者。 */
function fakeSubscriber(): NapcatEventSubscriber & {
  deliver: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { deliver: vi.fn(), heartbeat: vi.fn(), close: vi.fn() };
}

describe("NapcatEventBroadcaster", () => {
  it("publish 扇出给所有活订阅者", () => {
    const b = new NapcatEventBroadcaster();
    const a = fakeSubscriber();
    const c = fakeSubscriber();
    b.add(a);
    b.add(c);
    b.publish(outbox(1));
    expect(a.deliver).toHaveBeenCalledWith(outbox(1));
    expect(c.deliver).toHaveBeenCalledWith(outbox(1));
  });

  it("deliver 抛错的订阅者被摘除，不影响其余", () => {
    const b = new NapcatEventBroadcaster();
    const bad = fakeSubscriber();
    bad.deliver.mockImplementation(() => {
      throw new Error("write EPIPE");
    });
    const good = fakeSubscriber();
    b.add(bad);
    b.add(good);
    b.publish(outbox(1));
    // bad 已被摘除：下一次 publish 不再调用它，good 照常收。
    b.publish(outbox(2));
    expect(bad.deliver).toHaveBeenCalledTimes(1);
    expect(good.deliver).toHaveBeenCalledTimes(2);
  });

  it("closeAll 结束所有连接并清空订阅集（关停 teardown）", () => {
    const b = new NapcatEventBroadcaster();
    const a = fakeSubscriber();
    const c = fakeSubscriber();
    b.add(a);
    b.add(c);
    b.closeAll();
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(c.close).toHaveBeenCalledTimes(1);
    // 清空后再 publish 不会触达任何人。
    b.publish(outbox(1));
    expect(a.deliver).not.toHaveBeenCalled();
    expect(c.deliver).not.toHaveBeenCalled();
  });

  it("closeAll 对 close 抛错的订阅者也稳健（逐个 safe 包裹）", () => {
    const b = new NapcatEventBroadcaster();
    const bad = fakeSubscriber();
    bad.close.mockImplementation(() => {
      throw new Error("already destroyed");
    });
    const good = fakeSubscriber();
    b.add(bad);
    b.add(good);
    expect(() => b.closeAll()).not.toThrow();
    expect(good.close).toHaveBeenCalledTimes(1);
  });
});
