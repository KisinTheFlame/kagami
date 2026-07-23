import { describe, expect, it } from "vitest";
import {
  mapAppLogItem,
  mapInnerThoughtItem,
  mapTodoItem,
} from "../../src/ops/http/ops-query.handler.js";
import type { TodoItemRow } from "@kagami/persistence/dao/todo-item.dao";

// 序列化/归一是 console 脱库（#539 子 issue 4）后从 console mapper 迁来的纯逻辑，
// 原 console 侧单测随迁于此。归一守卫（repeatEveryMs<=0 → null）是防「一条 legacy 坏行
// 让整页只读查询在契约 .positive() output.parse 处 500」的关键，必须有测试兜底。

function makeTodoRow(overrides: Partial<TodoItemRow> = {}): TodoItemRow {
  return {
    id: 1,
    title: "写周报",
    note: null,
    status: "pending",
    remindAt: null,
    repeatEveryMs: null,
    snoozedUntil: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-02T00:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

describe("ops-query mappers", () => {
  it("mapTodoItem 把 repeatEveryMs<=0 的 legacy 值归一成 null，正值原样保留", () => {
    expect(mapTodoItem(makeTodoRow({ repeatEveryMs: 0 })).repeatEveryMs).toBeNull();
    expect(mapTodoItem(makeTodoRow({ repeatEveryMs: -5 })).repeatEveryMs).toBeNull();
    expect(mapTodoItem(makeTodoRow({ repeatEveryMs: null })).repeatEveryMs).toBeNull();
    expect(mapTodoItem(makeTodoRow({ repeatEveryMs: 86_400_000 })).repeatEveryMs).toBe(86_400_000);
  });

  it("mapTodoItem 序列化全部时间字段为 ISO，可空字段保 null", () => {
    const item = mapTodoItem(
      makeTodoRow({
        remindAt: new Date("2026-04-03T01:02:03.000Z"),
        completedAt: null,
        snoozedUntil: null,
      }),
    );
    expect(item.createdAt).toBe("2026-04-01T00:00:00.000Z");
    expect(item.updatedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(item.remindAt).toBe("2026-04-03T01:02:03.000Z");
    expect(item.snoozedUntil).toBeNull();
    expect(item.completedAt).toBeNull();
  });

  it("mapInnerThoughtItem / mapAppLogItem 序列化 Date 并透传其余字段", () => {
    expect(
      mapInnerThoughtItem({
        id: 7,
        triggeredAt: new Date("2026-07-04T06:00:00.000Z"),
        outcome: "injected",
        thought: "想翻翻那篇文章",
        runtimeKey: "root-agent",
        createdAt: new Date("2026-07-04T06:00:01.000Z"),
      }),
    ).toEqual({
      id: 7,
      triggeredAt: "2026-07-04T06:00:00.000Z",
      outcome: "injected",
      thought: "想翻翻那篇文章",
      runtimeKey: "root-agent",
      createdAt: "2026-07-04T06:00:01.000Z",
    });

    expect(
      mapAppLogItem({
        id: 3,
        traceId: "trace-3",
        level: "warn",
        message: "boom",
        metadata: { source: "agent" },
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).toEqual({
      id: 3,
      traceId: "trace-3",
      level: "warn",
      message: "boom",
      metadata: { source: "agent" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });
  });
});
