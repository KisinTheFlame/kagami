import { describe, expect, it } from "vitest";
import type { TodoItemRow } from "@kagami/persistence/dao/todo-item.dao";
import { mapTodoList } from "../../src/ops/mappers/todo.mapper.js";

describe("todo mapper", () => {
  it("mapTodoList should serialize dates to ISO and pass through nulls", () => {
    const row: TodoItemRow = {
      id: 7,
      title: "写周报",
      note: null,
      status: "pending",
      remindAt: new Date("2026-04-02T03:04:05.000Z"),
      repeatEveryMs: null,
      snoozedUntil: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T01:00:00.000Z"),
      completedAt: null,
    };

    expect(
      mapTodoList({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [row],
      }),
    ).toEqual({
      pagination: { page: 1, pageSize: 20, total: 1 },
      items: [
        {
          id: 7,
          title: "写周报",
          note: null,
          status: "pending",
          remindAt: "2026-04-02T03:04:05.000Z",
          repeatEveryMs: null,
          snoozedUntil: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T01:00:00.000Z",
          completedAt: null,
        },
      ],
    });
  });

  it("mapTodoList should serialize every optional date field when present", () => {
    const row: TodoItemRow = {
      id: 9,
      title: "浇花",
      note: "阳台那盆",
      status: "completed",
      remindAt: new Date("2026-05-01T08:00:00.000Z"),
      repeatEveryMs: 86_400_000,
      snoozedUntil: new Date("2026-05-01T09:00:00.000Z"),
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      completedAt: new Date("2026-05-01T10:00:00.000Z"),
    };

    const result = mapTodoList({ page: 2, pageSize: 20, total: 41, items: [row] });

    expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 41 });
    expect(result.items[0]).toEqual({
      id: 9,
      title: "浇花",
      note: "阳台那盆",
      status: "completed",
      remindAt: "2026-05-01T08:00:00.000Z",
      repeatEveryMs: 86_400_000,
      snoozedUntil: "2026-05-01T09:00:00.000Z",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z",
      completedAt: "2026-05-01T10:00:00.000Z",
    });
  });
});
