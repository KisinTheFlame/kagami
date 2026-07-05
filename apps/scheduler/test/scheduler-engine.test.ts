import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { SchedulerEngine } from "../src/application/scheduler-engine.js";
import { TickBroadcaster, type TickSubscriber } from "../src/application/tick-broadcaster.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

function recordingSubscriber(): { sub: TickSubscriber; ticks: unknown[] } {
  const ticks: unknown[] = [];
  const sub: TickSubscriber = {
    write: chunk => {
      const data = chunk.replace(/^data: /, "").trim();
      if (data.length > 0) {
        ticks.push(JSON.parse(data));
      }
    },
    heartbeat: () => {},
  };
  return { sub, ticks };
}

function intervalTask(
  name: string,
  intervalMs: number,
  misfire: "drop" | "latest" | "catchup",
  maxCatchup?: number,
) {
  return {
    name,
    schedule: { kind: "interval" as const, intervalMs, initialDelayMs: 0 },
    misfire,
    ...(maxCatchup !== undefined ? { maxCatchup } : {}),
  };
}

describe("SchedulerEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers a tick live when the owner has a subscriber", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });
    const { sub, ticks } = recordingSubscriber();
    broadcaster.add("agent", sub);

    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 1,
      tasks: [intervalTask("t", 1_000, "latest")],
    });
    vi.advanceTimersByTime(1); // initial fire at delay 0

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ taskName: "t", manual: false });
  });

  it("buffers latest pending when no subscriber, then flushes one on connect", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });

    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 1,
      tasks: [intervalTask("t", 100, "latest")],
    });
    vi.advanceTimersByTime(350); // fires at 0,100,200,300 with no subscriber

    const { sub, ticks } = recordingSubscriber();
    broadcaster.add("agent", sub);
    engine.flushPending("agent");
    expect(ticks).toHaveLength(1); // latest coalesced to one
  });

  it("drops pending entirely under misfire=drop", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });
    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 1,
      tasks: [intervalTask("t", 100, "drop")],
    });
    vi.advanceTimersByTime(350);

    const { sub, ticks } = recordingSubscriber();
    broadcaster.add("agent", sub);
    engine.flushPending("agent");
    expect(ticks).toHaveLength(0);
  });

  it("keeps at most maxCatchup pending under misfire=catchup", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });
    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 1,
      tasks: [intervalTask("t", 100, "catchup", 2)],
    });
    vi.advanceTimersByTime(450); // fires at 0,100,200,300,400 = 5 times, no subscriber

    const { sub, ticks } = recordingSubscriber();
    broadcaster.add("agent", sub);
    engine.flushPending("agent");
    expect(ticks).toHaveLength(2); // most recent 2 only
  });

  it("rejects stale generation and accepts newer", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });
    const tasks = [intervalTask("t", 1_000, "latest")];

    expect(
      engine.register({ ownerId: "agent", clientInstanceId: "c1", generation: 5, tasks }).accepted,
    ).toBe(true);
    const stale = engine.register({
      ownerId: "agent",
      clientInstanceId: "c2",
      generation: 3,
      tasks,
    });
    expect(stale.accepted).toBe(false);
    expect(
      engine.register({ ownerId: "agent", clientInstanceId: "c3", generation: 6, tasks }).accepted,
    ).toBe(true);
  });

  it("stops firing a task removed by replace-all", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });
    const { sub, ticks } = recordingSubscriber();
    broadcaster.add("agent", sub);

    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 1,
      tasks: [intervalTask("a", 100, "latest"), intervalTask("b", 100, "latest")],
    });
    // re-register with only "a": schedule unchanged for "a" (kept), "b" removed (driver stopped).
    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 2,
      tasks: [intervalTask("a", 100, "latest")],
    });
    ticks.length = 0;
    vi.advanceTimersByTime(120); // one more fire

    const firedNames = new Set(ticks.map(t => (t as { taskName: string }).taskName));
    expect(firedNames.has("a")).toBe(true);
    expect(firedNames.has("b")).toBe(false);
  });

  it("status reports registered tasks with nextRunAt", () => {
    const broadcaster = new TickBroadcaster();
    const engine = new SchedulerEngine({ broadcaster });
    engine.register({
      ownerId: "agent",
      clientInstanceId: "c1",
      generation: 1,
      tasks: [intervalTask("t", 1_000, "latest")],
    });
    const status = engine.status("agent");
    expect(status.tasks).toHaveLength(1);
    expect(status.tasks[0]!.name).toBe("t");
    expect(status.tasks[0]!.nextRunAt).not.toBeNull();
    expect(engine.status("nobody").tasks).toHaveLength(0);
  });
});
