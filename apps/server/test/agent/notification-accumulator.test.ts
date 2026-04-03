import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NotificationAccumulator } from "../../src/agent/runtime/root-agent/notification/notification-accumulator.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

describe("NotificationAccumulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return null when pending is empty", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });
    expect(accumulator.tryFlush()).toBeNull();
  });

  it("should return null when time window has not elapsed", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });

    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：你好",
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(29_999);
    expect(accumulator.tryFlush()).toBeNull();
  });

  it("should flush when time window has elapsed", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });

    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：你好",
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(30_000);
    const result = accumulator.tryFlush();

    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：你好",
    });
  });

  it("should clear pending after flush", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });

    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：你好",
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(30_000);
    accumulator.tryFlush();

    vi.advanceTimersByTime(30_000);
    expect(accumulator.tryFlush()).toBeNull();
  });

  it("should overwrite same stateId with latest entry", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });

    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：第一条",
      timestamp: Date.now(),
    });
    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "李四：第二条",
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(30_000);
    const result = accumulator.tryFlush();

    expect(result).toHaveLength(1);
    expect(result![0].summary).toBe("李四：第二条");
  });

  it("should keep entries for different stateIds", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });

    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：你好",
      timestamp: Date.now(),
    });
    accumulator.push({
      stateId: "qq_private:456",
      displayName: "李四",
      summary: "李四：在吗",
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(30_000);
    const result = accumulator.tryFlush();

    expect(result).toHaveLength(2);
    const stateIds = result!.map(e => e.stateId);
    expect(stateIds).toContain("qq_group:123");
    expect(stateIds).toContain("qq_private:456");
  });

  it("should clear pending for a specific state", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });

    accumulator.push({
      stateId: "qq_group:123",
      displayName: "技术群",
      summary: "张三：你好",
      timestamp: Date.now(),
    });
    accumulator.push({
      stateId: "qq_group:456",
      displayName: "闲聊群",
      summary: "王五：哈哈",
      timestamp: Date.now(),
    });

    accumulator.clearForState("qq_group:123");

    vi.advanceTimersByTime(30_000);
    const result = accumulator.tryFlush();

    expect(result).toHaveLength(1);
    expect(result![0].stateId).toBe("qq_group:456");
  });

  it("should not throw when clearing non-existent state", () => {
    const accumulator = new NotificationAccumulator({ timeWindowMs: 30_000 });
    expect(() => accumulator.clearForState("non_existent")).not.toThrow();
  });
});
