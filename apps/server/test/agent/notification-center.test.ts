import { describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "../../src/agent/runtime/root-agent/notification/notification-center.js";
import type { NotificationDraft } from "../../src/agent/runtime/root-agent/notification/notification-draft.js";
import type { NotificationScheduler } from "../../src/agent/runtime/root-agent/notification/notification-scheduler.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

/** 确定性假定时器：捕获 center 安排的 flush，由测试手动「推进窗口」。 */
class FakeScheduler implements NotificationScheduler {
  private fns: Array<() => void> = [];

  public schedule(_delayMs: number, fn: () => void): void {
    this.fns.push(fn);
  }

  public fire(): void {
    const fns = this.fns;
    this.fns = [];
    for (const fn of fns) {
      fn();
    }
  }

  public scheduledCount(): number {
    return this.fns.length;
  }
}

/**
 * 最小可控 draft，用来测 center 的**源无关机制**。具体折叠语义（计数 / @ 粘住等）
 * 由各源自己的 draft 测试覆盖。
 */
class FakeDraft implements NotificationDraft {
  public constructor(
    public readonly sourceId: string,
    public readonly displayName: string,
    private readonly text: string,
    private readonly throwOnRender = false,
  ) {}

  public merge(prev: NotificationDraft): NotificationDraft {
    const previous = prev as FakeDraft;
    // this = 最新；把历史文本拼上，证明 merge 确实收到了 prev。
    return new FakeDraft(this.sourceId, this.displayName, `${previous.text}+${this.text}`);
  }

  public render(): string {
    if (this.throwOnRender) {
      throw new Error("render boom");
    }
    return `${this.displayName}: ${this.text}`;
  }
}

describe("NotificationCenter", () => {
  it("flushes one line per source after the window, not before", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "A", "1"));
    center.push(new FakeDraft("b", "B", "2"));
    expect(onFlush).not.toHaveBeenCalled();

    scheduler.fire();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(["A: 1", "B: 2"]);
  });

  it("folds same-source pushes within a window via merge(prev)", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "A", "1"));
    center.push(new FakeDraft("a", "A", "2"));
    // 第一条 push 起窗，后续同窗不重排。
    expect(scheduler.scheduledCount()).toBe(1);

    scheduler.fire();
    // merge：this = 最新("2")、prev = 历史("1") → "1+2"。
    expect(onFlush).toHaveBeenCalledWith(["A: 1+2"]);
  });

  it("does not enqueue when pending was cleared before the window fired", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "A", "1"));
    center.clearForSource("a");
    scheduler.fire();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("is defensive: a draft whose render throws is skipped, others still flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "A", "1", true));
    center.push(new FakeDraft("b", "B", "2"));
    scheduler.fire();
    expect(onFlush).toHaveBeenCalledWith(["B: 2"]);
  });

  it("starts a fresh window after a flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "A", "1"));
    scheduler.fire();
    expect(onFlush).toHaveBeenCalledTimes(1);

    center.push(new FakeDraft("a", "A", "3"));
    expect(scheduler.scheduledCount()).toBe(1);
    scheduler.fire();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenLastCalledWith(["A: 3"]);
  });
});
