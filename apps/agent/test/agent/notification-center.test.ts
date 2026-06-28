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
  // FakeScheduler 忽略 delayMs，只捕获回调；前沿短窗与节流窗时长仅作记录性区分。
  return new NotificationCenter({ leadingWindowMs: 50, windowMs: 100, onFlush, scheduler });
}

describe("NotificationCenter (前沿短窗 + 节流)", () => {
  it("空闲来第一条不立即发，攒到前沿短窗结束才 flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1"));
    expect(onFlush).not.toHaveBeenCalled(); // 短窗内攒着，不前沿立即发

    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1"]);
  });

  it("把前沿短窗内到达的通知聚合，窗结束一并 flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1")); // 开前沿短窗
    c.push(new FakeDraft("b", "QQ", "B", "2")); // 窗内攒着
    c.push(new FakeDraft("c", "QQ", "C", "3")); // 窗内攒着
    expect(onFlush).not.toHaveBeenCalled();

    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1", "B: 2", "C: 3"]);
  });

  it("空窗后回到空闲，下一条重新走前沿短窗", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1")); // 开前沿短窗
    scheduler.fireWindowEnd(); // 短窗结束 → flush 首批（call 1），开节流窗
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1"]);

    scheduler.fireWindowEnd(); // 节流窗内空 → 回空闲，不 flush
    expect(onFlush).toHaveBeenCalledTimes(1);

    c.push(new FakeDraft("b", "QQ", "B", "2")); // 又空闲 → 开新前沿短窗，不立即发
    expect(onFlush).toHaveBeenCalledTimes(1);
    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0]).toEqual(["QQ:", "B: 2"]);
  });

  it("折叠前沿短窗内的同源消息", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("a", "QQ", "A", "1")); // 开前沿短窗
    c.push(new FakeDraft("a", "QQ", "A", "2")); // 窗内，与上一条折叠 → "1+2"
    c.push(new FakeDraft("a", "QQ", "A", "3")); // 窗内，再折叠 → "1+2+3"
    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "A: 1+2+3"]);
  });

  it("把同一批 draft 按 group 分段", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("seed", "QQ", "Seed", "0")); // 开前沿短窗
    c.push(new FakeDraft("a", "QQ", "A", "1")); // 窗内
    c.push(new FakeDraft("ithome", "IT之家", "IT之家", "x")); // 窗内
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[0][0]).toEqual([
      "QQ:",
      "Seed: 0",
      "A: 1",
      "",
      "IT之家:",
      "IT之家: x",
    ]);
  });

  it("clearForSource 在窗结束前丢掉一个待发源", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("seed", "QQ", "Seed", "0")); // 开前沿短窗
    c.push(new FakeDraft("a", "QQ", "A", "1")); // 窗内
    c.clearForSource("a"); // 丢掉 a，只剩 seed
    scheduler.fireWindowEnd();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "Seed: 0"]);
  });

  it("防御性：某个 draft 的 render 抛错只跳过它，其余照常 flush", () => {
    const scheduler = new FakeScheduler();
    const onFlush = vi.fn();
    const c = center(scheduler, onFlush);

    c.push(new FakeDraft("seed", "QQ", "Seed", "0")); // 开前沿短窗
    c.push(new FakeDraft("x", "QQ", "X", "1", true)); // 窗内，render 抛错
    c.push(new FakeDraft("y", "QQ", "Y", "2")); // 窗内
    scheduler.fireWindowEnd();
    expect(onFlush.mock.calls[0][0]).toEqual(["QQ:", "Seed: 0", "Y: 2"]);
  });
});
