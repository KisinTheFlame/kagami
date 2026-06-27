import { describe, expect, it } from "vitest";
import {
  computeNextRemindAt,
  TodoService,
} from "../../../../src/agent/capabilities/todo/application/todo.service.js";
import { InvalidTimeError } from "../../../../src/agent/capabilities/todo/application/parse-reminder-time.js";
import { MAX_ACTIVE_TODOS } from "../../../../src/agent/capabilities/todo/application/todo.constants.js";
import { InMemoryTodoDao } from "../../../helpers/in-memory-todo.dao.js";

function setup(start = new Date("2026-06-27T00:00:00.000Z")) {
  let current = start;
  const now = (): Date => current;
  const dao = new InMemoryTodoDao(now);
  const service = new TodoService({ todoDao: dao, now });
  return {
    dao,
    service,
    advanceClock: (ms: number): void => {
      current = new Date(current.getTime() + ms);
    },
    setClock: (date: Date): void => {
      current = date;
    },
  };
}

describe("TodoService.addTodo", () => {
  it("happy：记下并返回 id", async () => {
    const { service } = setup();
    const result = await service.addTodo({ title: "写周报" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.todo.id).toBe(1);
      expect(result.todo.title).toBe("写周报");
    }
  });

  it("撞上限返回 LIMIT_REACHED", async () => {
    const { service, dao } = setup();
    for (let i = 0; i < MAX_ACTIVE_TODOS; i++) {
      await service.addTodo({ title: `t${i}` });
    }
    const result = await service.addTodo({ title: "超额" });
    expect(result).toEqual({ ok: false, error: "LIMIT_REACHED" });
    expect(dao.rows.size).toBe(MAX_ACTIVE_TODOS);
  });

  it("过去时刻的 remindAt 抛 InvalidTimeError", async () => {
    const { service } = setup();
    await expect(
      service.addTodo({ title: "x", remindAt: "2020-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(InvalidTimeError);
  });

  it("repeatEvery 低于下限抛 InvalidTimeError", async () => {
    const { service } = setup();
    await expect(service.addTodo({ title: "x", repeatEvery: "1s" })).rejects.toBeInstanceOf(
      InvalidTimeError,
    );
  });
});

describe("TodoService 状态变更", () => {
  it("complete / remove / snooze / update 对不存在 id 返回 false", async () => {
    const { service } = setup();
    expect(await service.completeTodo({ id: 999 })).toBe(false);
    expect(await service.removeTodo({ id: 999 })).toBe(false);
    expect(await service.snoozeTodo({ id: 999, forMinutes: 10 })).toBe(false);
    expect(await service.updateTodo({ id: 999, title: "x" })).toBe(false);
  });

  it("complete 后不再是 pending", async () => {
    const { service, dao } = setup();
    await service.addTodo({ title: "a" });
    expect(await service.completeTodo({ id: 1 })).toBe(true);
    expect(dao.rows.get(1)?.status).toBe("completed");
    // 已 complete 再 complete 不命中
    expect(await service.completeTodo({ id: 1 })).toBe(false);
  });

  it("remove 是 soft delete（status=removed）", async () => {
    const { service, dao } = setup();
    await service.addTodo({ title: "a" });
    expect(await service.removeTodo({ id: 1 })).toBe(true);
    expect(dao.rows.get(1)?.status).toBe("removed");
  });

  it("snooze 需且仅需一个 until/forMinutes", async () => {
    const { service } = setup();
    await service.addTodo({ title: "a", remindAt: "1h" });
    await expect(service.snoozeTodo({ id: 1 })).rejects.toBeInstanceOf(InvalidTimeError);
    await expect(service.snoozeTodo({ id: 1, until: "1h", forMinutes: 10 })).rejects.toBeInstanceOf(
      InvalidTimeError,
    );
    expect(await service.snoozeTodo({ id: 1, forMinutes: 30 })).toBe(true);
  });
});

describe("TodoService.listView", () => {
  it("pending / done / all 三态", async () => {
    const { service } = setup();
    await service.addTodo({ title: "p1" });
    await service.addTodo({ title: "p2" });
    await service.addTodo({ title: "d1" });
    await service.completeTodo({ id: 3 });

    const pending = await service.listView({ filter: "pending", limit: 10 });
    expect(pending.total).toBe(2);
    expect(pending.todos.map(t => t.title)).toEqual(["p1", "p2"]);

    const done = await service.listView({ filter: "done", limit: 10 });
    expect(done.total).toBe(1);
    expect(done.todos.map(t => t.title)).toEqual(["d1"]);

    const all = await service.listView({ filter: "all", limit: 10 });
    expect(all.total).toBe(3);
  });
});

describe("TodoService.collectDueReminders（红线）", () => {
  it("空到期集返回 []（边沿触发：空拍零 push）", async () => {
    const { service } = setup();
    await service.addTodo({ title: "无提醒" });
    expect(await service.collectDueReminders()).toEqual([]);
  });

  it("一次性提醒到点后 push 一次并清空 remindAt，下拍不再到期", async () => {
    const { service, dao, advanceClock } = setup();
    await service.addTodo({ title: "一次性", remindAt: "10m" });
    advanceClock(11 * 60_000);
    const first = await service.collectDueReminders();
    expect(first).toEqual([{ id: 1, title: "一次性" }]);
    expect(dao.rows.get(1)?.remindAt).toBeNull();
    expect(await service.collectDueReminders()).toEqual([]);
  });

  it("停机后 overdue repeat 只 push 一次，remindAt 一次推到严格 > now（O(1) 不连刷）", async () => {
    const { service, dao, advanceClock } = setup();
    // 每小时重复，首次提醒在 10 分钟后
    await service.addTodo({ title: "重复", remindAt: "10m", repeatEvery: "1h" });
    const firstRemind = dao.rows.get(1)?.remindAt as Date;
    // 模拟停机半年后重启
    advanceClock(180 * 86_400_000);
    const due = await service.collectDueReminders();
    expect(due).toEqual([{ id: 1, title: "重复" }]); // 只一条，不是几千条
    const next = dao.rows.get(1)?.remindAt as Date;
    // remindAt 已严格推过 now，且仍落在原相位上（与 first 的差是 1h 的整数倍）
    // 实际 now = 首次提醒(start+10m) - 10m + 180d = start + 180d。
    const nowMs = firstRemind.getTime() - 10 * 60_000 + 180 * 86_400_000;
    expect(next.getTime()).toBeGreaterThan(nowMs);
    expect((next.getTime() - firstRemind.getTime()) % 3_600_000).toBe(0);
    // 同一拍再收集不再到期
    expect(await service.collectDueReminders()).toEqual([]);
  });

  it("snooze 未过的到期项被跳过、不 push、不续期；过后再 push", async () => {
    const { service, dao, advanceClock } = setup();
    await service.addTodo({ title: "snoozed", remindAt: "10m" });
    advanceClock(11 * 60_000); // 到点
    await service.snoozeTodo({ id: 1, forMinutes: 60 }); // 推迟 1 小时
    const remindAtBefore = dao.rows.get(1)?.remindAt as Date;
    expect(await service.collectDueReminders()).toEqual([]); // snooze 期内跳过
    expect(dao.rows.get(1)?.remindAt).toEqual(remindAtBefore); // 未续期/未动
    advanceClock(61 * 60_000); // snooze 过期
    expect(await service.collectDueReminders()).toEqual([{ id: 1, title: "snoozed" }]);
  });
});

describe("TodoService.buildDigest", () => {
  it("汇总未完成项，封顶并报总数", async () => {
    const { service } = setup();
    await service.addTodo({ title: "a" });
    await service.addTodo({ title: "b" });
    await service.addTodo({ title: "c" });
    await service.completeTodo({ id: 2 });
    const digest = await service.buildDigest({ limit: 2 });
    expect(digest.totalCount).toBe(2);
    expect(digest.items.map(i => i.title)).toEqual(["a", "c"]);
  });
});

describe("computeNextRemindAt", () => {
  const repeat = 3_600_000; // 1h
  it("now 落在周期边界上也严格推过 now（多推一个周期）", () => {
    const base = new Date("2026-06-27T00:00:00.000Z");
    const now = new Date("2026-06-27T02:00:00.000Z"); // 恰好 2 个周期后
    const next = computeNextRemindAt(base, repeat, now);
    expect(next.toISOString()).toBe("2026-06-27T03:00:00.000Z");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("now 在周期中间：推到下一个相位点", () => {
    const base = new Date("2026-06-27T00:00:00.000Z");
    const now = new Date("2026-06-27T02:30:00.000Z");
    const next = computeNextRemindAt(base, repeat, now);
    expect(next.toISOString()).toBe("2026-06-27T03:00:00.000Z");
  });
});
