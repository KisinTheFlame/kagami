import { describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "../../src/agent/runtime/root-agent/notification/notification-center.js";
import type { NotificationDraft } from "../../src/agent/runtime/root-agent/notification/notification-draft.js";
import type { NotificationScheduler } from "../../src/agent/runtime/root-agent/notification/notification-scheduler.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

/** 确定性假定时器（一次性）：捕获 center 开的节流窗口，由测试手动推进「窗口结束」。 */
class FakeScheduler implements NotificationScheduler {
  private fn: (() => void) | null = null;
  public schedule(_delayMs: number, fn: () => void): () => void {
    this.fn = fn;
    return () => {
      this.fn = null;
    };
  }
  /** 模拟窗口定时器到点。 */
  public fireWindowEnd(): void {
    const fn = this.fn;
    this.fn = null;
    fn?.();
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

function center(scheduler: FakeScheduler, onFlush: (lines: string[]) => void): NotificationCenter {
  return new NotificationCenter({ windowMs: 100, onFlush, scheduler });
}

describe("NotificationCenter (leading-edge throttle)", () => {
  it("fires the first notification immediately when idle (leading edge)", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1"));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1"]);
  });

  it("batches notifications that arrive during the window, flushing at window end", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1")); // 前沿立即
    c.push(new FakeDraft("b", "QQ", "B", "2")); // 窗内攒着
    c.push(new FakeDraft("c", "QQ", "C", "3")); // 窗内攒着
    expect(onFlush).toHaveBeenCalledTimes(1);

    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "B: 2", "C: 3"]);
  });

  it("goes idle after an empty window, so the next notification is immediate again", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1")); // 前沿立即（call 1）
    scheduler.fireWindowEnd(); // 窗内空 → 回空闲，不 flush
    expect(onFlush).toHaveBeenCalledTimes(1);

    c.push(new FakeDraft("b", "QQ", "B", "2")); // 又空闲 → 立即（call 2）
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "B: 2"]);
  });

  it("folds same-source messages that arrive during the window", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1")); // 前沿立即（单独）
    c.push(new FakeDraft("a", "QQ", "A", "2")); // 窗内
    c.push(new FakeDraft("a", "QQ", "A", "3")); // 窗内，与上一条折叠 → "2+3"
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "A: 2+3"]);
  });

  it("groups window-batched drafts by group into sections", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("seed", "QQ", "Seed", "0")); // 前沿，开窗
    c.push(new FakeDraft("a", "QQ", "A", "1")); // 窗内
    c.push(new FakeDraft("ithome", "IT之家", "IT之家", "x")); // 窗内
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "A: 1", "", "IT之家:", "IT之家: x"]);
  });

  it("clearForSource drops a pending source before the window ends", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("seed", "QQ", "Seed", "0")); // 前沿，开窗
    c.push(new FakeDraft("a", "QQ", "A", "1")); // 窗内
    c.clearForSource("a");
    scheduler.fireWindowEnd();
    // 窗内被清空 → 回空闲，不再 flush（只有前沿那一次）。
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("is defensive: a draft whose render throws is skipped, others still flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("seed", "QQ", "Seed", "0")); // 前沿，开窗
    c.push(new FakeDraft("x", "QQ", "X", "1", true)); // 窗内，render 抛错
    c.push(new FakeDraft("y", "QQ", "Y", "2")); // 窗内
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "Y: 2"]);
  });
});
