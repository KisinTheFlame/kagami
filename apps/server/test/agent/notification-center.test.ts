import { describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "../../src/agent/runtime/root-agent/notification/notification-center.js";
import type { NotificationDraft } from "../../src/agent/runtime/root-agent/notification/notification-draft.js";
import type { NotificationScheduler } from "../../src/agent/runtime/root-agent/notification/notification-scheduler.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

/** 确定性假定时器：捕获 center 的固定扫描，由测试手动 tick 一次扫描。 */
class FakeScheduler implements NotificationScheduler {
  private fn: (() => void) | null = null;
  public scheduleInterval(_intervalMs: number, fn: () => void): () => void {
    this.fn = fn;
    return () => {
      this.fn = null;
    };
  }
  public tick(): void {
    this.fn?.();
  }
}

/** 最小可控 draft，用来测 center 的源无关机制（分组 / 折叠 / 防御性）。 */
class FakeDraft implements NotificationDraft {
  public constructor(
    public readonly sourceId: string,
    public readonly group: string,
    public readonly displayName: string,
    private readonly text: string,
    private readonly throwOnRender = false,
  ) {}
  public merge(prev: NotificationDraft): NotificationDraft {
    const previous = prev as FakeDraft;
    // this = 最新；拼上历史文本以证明 merge 收到了 prev。
    return new FakeDraft(
      this.sourceId,
      this.group,
      this.displayName,
      `${previous.text}+${this.text}`,
    );
  }
  public render(): string {
    if (this.throwOnRender) {
      throw new Error("render boom");
    }
    return `${this.displayName}: ${this.text}`;
  }
}

describe("NotificationCenter", () => {
  it("groups drafts by group into sections at the periodic scan, not before", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "QQ", "A", "1"));
    center.push(new FakeDraft("b", "QQ", "B", "2"));
    center.push(new FakeDraft("ithome", "IT之家", "IT之家", "x"));
    expect(onFlush).not.toHaveBeenCalled();

    scheduler.tick();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1", "B: 2", "", "IT之家:", "IT之家: x"]);
  });

  it("folds same-source pushes within a scan via merge(prev)", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "QQ", "A", "1"));
    center.push(new FakeDraft("a", "QQ", "A", "2"));
    scheduler.tick();
    // merge：this = 最新("2")、prev = 历史("1") → "1+2"。
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1+2"]);
  });

  it("does not flush an empty scan", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });
    expect(center).toBeInstanceOf(NotificationCenter);
    scheduler.tick();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("clearForSource drops a pending source before the scan", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "QQ", "A", "1"));
    center.clearForSource("a");
    scheduler.tick();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("is defensive: a draft whose render throws is skipped, others still flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "QQ", "A", "1", true));
    center.push(new FakeDraft("b", "QQ", "B", "2"));
    scheduler.tick();
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "B: 2"]);
  });

  it("scans repeatedly (fixed interval), flushing whatever is pending each time", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const center = new NotificationCenter({ windowMs: 100, onFlush, scheduler });

    center.push(new FakeDraft("a", "QQ", "A", "1"));
    scheduler.tick();
    expect(onFlush).toHaveBeenCalledTimes(1);

    center.push(new FakeDraft("a", "QQ", "A", "3"));
    scheduler.tick();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "A: 3"]);
  });
});
