import { describe, expect, it, vi } from "vitest";
import type { NapcatAgentEvent, NapcatOutboxEvent } from "@kagami/napcat-api/event";
import { NapcatSseSubscriber } from "../src/http/napcat-events.handler.js";
import type { NapcatEventOutboxDao } from "../src/infra/napcat-event-outbox.dao.js";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogEvent, LogSink } from "@kagami/kernel/logger/types";

/** 最小事件：好友列表更新（形状最简，内容与本测试无关）。 */
function event(): NapcatAgentEvent {
  return { type: "napcat_friend_list_updated", data: { friends: [] } };
}

function outbox(seq: number): NapcatOutboxEvent {
  return { seq, event: event() };
}

/** 内存 outbox：seq 升序保存，listAfter 分页、latestSeq 取尾。可注入固定「回放期间新到的行」。 */
class FakeOutboxDao implements NapcatEventOutboxDao {
  public constructor(private readonly rows: NapcatOutboxEvent[]) {}
  public append(): Promise<number> {
    throw new Error("not used");
  }
  public async listAfter(afterSeq: number, limit: number): Promise<NapcatOutboxEvent[]> {
    return this.rows.filter(row => row.seq > afterSeq).slice(0, limit);
  }
  public async latestSeq(): Promise<number> {
    return this.rows.length === 0 ? 0 : this.rows[this.rows.length - 1]!.seq;
  }
  public pruneOlderThan(): Promise<number> {
    throw new Error("not used");
  }
}

/** 从 SSE 帧串里抽出写出的 seq 序列。 */
function writtenSeqs(chunks: string[]): number[] {
  return chunks
    .filter(chunk => chunk.startsWith("id: "))
    .map(chunk => Number(chunk.slice(4, chunk.indexOf("\n"))));
}

describe("NapcatSseSubscriber replay", () => {
  it("回放 lastEventId 之后的缺口，按 seq 升序、每条一次", async () => {
    const chunks: string[] = [];
    const sub = new NapcatSseSubscriber({
      write: c => chunks.push(c),
      outboxDao: new FakeOutboxDao([outbox(1), outbox(2), outbox(3), outbox(4)]),
      lastEventId: 2,
    });
    await sub.start();
    expect(writtenSeqs(chunks)).toEqual([3, 4]);
  });

  it("close 后一切写短路（关停 teardown 不写已 end 的 res）", async () => {
    const chunks: string[] = [];
    let ended = false;
    const sub = new NapcatSseSubscriber({
      write: c => chunks.push(c),
      close: () => {
        ended = true;
      },
      outboxDao: new FakeOutboxDao([outbox(1), outbox(2)]),
      lastEventId: 0,
    });
    await sub.start();
    const before = chunks.length;
    sub.close();
    expect(ended).toBe(true);
    // close 后 live 事件 / 心跳都不再写。
    sub.deliver(outbox(3));
    sub.heartbeat();
    expect(chunks.length).toBe(before);
  });

  it("高水位有界：回放只到 start 瞬间的 latestSeq，之后的实时事件走 buffer 不进回放", async () => {
    // 回放期间 deliver 进来的实时事件（seq 5、6）已在 dao 里（模拟持续入站），但快照 high=4，
    // 回放止于 4；5、6 经 buffer 补发。没有高水位就会一直 listAfter 追下去（review 发现的死循环）。
    const dao = new FakeOutboxDao([
      outbox(1),
      outbox(2),
      outbox(3),
      outbox(4),
      outbox(5),
      outbox(6),
    ]);
    const highSpy = vi.spyOn(dao, "latestSeq").mockResolvedValueOnce(4);
    const chunks: string[] = [];
    const sub = new NapcatSseSubscriber({
      write: c => chunks.push(c),
      outboxDao: dao,
      lastEventId: 0,
    });
    sub.deliver(outbox(5)); // buffering 阶段的实时事件
    sub.deliver(outbox(6));
    await sub.start();
    expect(highSpy).toHaveBeenCalledTimes(1);
    // 1-4 回放 + 5-6 flush，全程升序、无重复。
    expect(writtenSeqs(chunks)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("回放与 buffer 重叠的 seq 只写一次（去重）", async () => {
    const dao = new FakeOutboxDao([outbox(1), outbox(2), outbox(3)]);
    const chunks: string[] = [];
    const sub = new NapcatSseSubscriber({
      write: c => chunks.push(c),
      outboxDao: dao,
      lastEventId: 0,
    });
    sub.deliver(outbox(3)); // 3 既在回放范围又在 buffer
    await sub.start();
    expect(writtenSeqs(chunks)).toEqual([1, 2, 3]);
  });

  it("缺口检测：请求续传的 seq 已被 prune 时吼一声 error", async () => {
    const logs: LogEvent[] = [];
    const sink: LogSink = {
      write: e => {
        logs.push(e);
      },
    };
    initLoggerRuntime({ sinks: [sink] });
    // agent 从 seq 2 续，但现存最早只剩 7（中间 3-6 被 prune）。
    const dao = new FakeOutboxDao([outbox(7), outbox(8)]);
    const chunks: string[] = [];
    const sub = new NapcatSseSubscriber({
      write: c => chunks.push(c),
      outboxDao: dao,
      lastEventId: 2,
    });
    await sub.start();
    expect(writtenSeqs(chunks)).toEqual([7, 8]);
    const gap = logs.find(l => l.metadata?.event === "napcat.events.replay_gap");
    expect(gap).toBeDefined();
    expect(gap?.metadata?.lostCount).toBe(4); // 3,4,5,6
  });
});
