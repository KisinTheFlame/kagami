import { describe, expect, it } from "vitest";
import { TaskRunHistory } from "../../src/scheduler/domain/task-run-history.js";
import type { TaskRun } from "../../src/scheduler/domain/scheduled-task.js";

function makeRun(i: number): TaskRun {
  return {
    startedAt: new Date(1_700_000_000_000 + i * 1_000),
    finishedAt: new Date(1_700_000_000_000 + i * 1_000 + 50),
    durationMs: 50,
    status: "success",
  };
}

describe("TaskRunHistory", () => {
  it("rejects non-positive capacity", () => {
    expect(() => new TaskRunHistory({ capacity: 0 })).toThrow();
    expect(() => new TaskRunHistory({ capacity: -1 })).toThrow();
  });

  it("keeps push order under capacity", () => {
    const history = new TaskRunHistory({ capacity: 3 });
    history.push(makeRun(1));
    history.push(makeRun(2));
    expect(history.toArray().map(r => r.startedAt.getTime())).toEqual([
      1_700_000_001_000, 1_700_000_002_000,
    ]);
  });

  it("drops the oldest entry once capacity is exceeded", () => {
    const history = new TaskRunHistory({ capacity: 2 });
    history.push(makeRun(1));
    history.push(makeRun(2));
    history.push(makeRun(3));
    expect(history.toArray().map(r => r.startedAt.getTime())).toEqual([
      1_700_000_002_000, 1_700_000_003_000,
    ]);
  });

  it("toArray returns a snapshot that does not share state with the buffer", () => {
    const history = new TaskRunHistory({ capacity: 3 });
    history.push(makeRun(1));
    const snapshot = history.toArray();
    history.push(makeRun(2));
    expect(snapshot).toHaveLength(1);
  });
});
