import { describe, expect, it } from "vitest";
import { TodoReminderPoller } from "../../../../src/agent/capabilities/todo/application/todo-reminder-poller.js";
import { TodoService } from "../../../../src/agent/capabilities/todo/application/todo.service.js";
import type {
  DigestSummary,
  DueReminder,
} from "../../../../src/agent/capabilities/todo/application/todo.service.js";
import { InMemoryTodoDao } from "../../../helpers/in-memory-todo.dao.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

function setup(
  start = new Date("2026-06-27T00:00:00.000Z"),
  suggestTodos: (openTodos: { title: string }[]) => Promise<string[]> = async () => [],
) {
  let current = start;
  const now = (): Date => current;
  const dao = new InMemoryTodoDao(now);
  const service = new TodoService({ todoDao: dao, now });
  const reminders: DueReminder[] = [];
  const digests: DigestSummary[] = [];
  const digestSuggestions: string[][] = [];
  const suggestCalls: { title: string }[][] = [];
  const poller = new TodoReminderPoller({
    todoService: service,
    onDueReminder: r => reminders.push(r),
    onDigest: (d, suggestions) => {
      digests.push(d);
      digestSuggestions.push(suggestions);
    },
    suggestTodos: openTodos => {
      suggestCalls.push(openTodos);
      return suggestTodos(openTodos);
    },
  });
  return {
    dao,
    service,
    poller,
    reminders,
    digests,
    digestSuggestions,
    suggestCalls,
    advanceClock: (ms: number): void => {
      current = new Date(current.getTime() + ms);
    },
  };
}

describe("TodoReminderPoller.runOnce", () => {
  it("有到期项 → 逐条回调；停机后 overdue repeat 只回调一次，且续期已推过 now（红线）", async () => {
    const { service, poller, reminders, advanceClock } = setup();
    await service.addTodo({ title: "重复", remindAt: "10m", repeatEvery: "1h" });
    advanceClock(180 * 86_400_000);
    await poller.runOnce();
    expect(reminders).toEqual([{ id: 1, title: "重复" }]);
    // 续期已严格推过当前 now：同一拍再跑零回调（不连刷）。
    await poller.runOnce();
    expect(reminders).toHaveLength(1);
  });

  it("空拍 → 零回调、零 push（边沿触发）", async () => {
    const { service, poller, reminders } = setup();
    await service.addTodo({ title: "无提醒" });
    await poller.runOnce();
    expect(reminders).toEqual([]);
  });

  it("DB 抛错 → catch+log 不 rethrow，不影响后续", async () => {
    const { dao, poller } = setup();
    dao.failFindDueOnce = true;
    await expect(poller.runOnce()).resolves.toBeUndefined();
  });
});

describe("TodoReminderPoller.runDigest", () => {
  it("有未完成项 → 回调一次 digest", async () => {
    const { service, poller, digests } = setup();
    await service.addTodo({ title: "a" });
    await poller.runDigest();
    expect(digests).toHaveLength(1);
    expect(digests[0].totalCount).toBe(1);
  });

  it("零未完成项 → 仍回调一次（无条件触发，用于推动小镜创建新待办）", async () => {
    const { poller, digests } = setup();
    await poller.runDigest();
    expect(digests).toHaveLength(1);
    expect(digests[0].totalCount).toBe(0);
  });

  it("把未完成项标题喂给 suggestTodos，并把返回的建议透传给 onDigest", async () => {
    const { service, poller, digestSuggestions, suggestCalls } = setup(
      new Date("2026-06-27T00:00:00.000Z"),
      async () => ["写周报", "回复闻震"],
    );
    await service.addTodo({ title: "a" });
    await service.addTodo({ title: "b" });
    await poller.runDigest();
    expect(suggestCalls).toHaveLength(1);
    expect(suggestCalls[0].map(item => item.title)).toEqual(["a", "b"]);
    expect(digestSuggestions).toEqual([["写周报", "回复闻震"]]);
  });

  it("suggestTodos reject → 仍照发 digest，且第三段降级为空（不丢 digest）", async () => {
    const { poller, digests, digestSuggestions } = setup(
      new Date("2026-06-27T00:00:00.000Z"),
      async () => {
        throw new Error("fork boom");
      },
    );
    await poller.runDigest();
    expect(digests).toHaveLength(1);
    expect(digestSuggestions).toEqual([[]]);
  });
});
