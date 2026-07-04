import { describe, expect, it } from "vitest";
import type { InnerThoughtSummary } from "@kagami/persistence/dao/inner-thought.dao";
import { mapInnerThoughtList } from "../../src/ops/mappers/inner-thought.mapper.js";

describe("mapInnerThoughtList", () => {
  it("maps dao summaries to wire items with iso dates", () => {
    const items: InnerThoughtSummary[] = [
      {
        id: 2,
        triggeredAt: new Date("2026-07-04T06:00:00.000Z"),
        outcome: "injected",
        thought: "想翻翻那篇文章",
        runtimeKey: "root-agent",
        createdAt: new Date("2026-07-04T06:00:01.000Z"),
      },
      {
        id: 1,
        triggeredAt: new Date("2026-07-04T05:50:00.000Z"),
        outcome: "empty",
        thought: "",
        runtimeKey: "root-agent",
        createdAt: new Date("2026-07-04T05:50:00.000Z"),
      },
    ];

    const result = mapInnerThoughtList({ page: 1, pageSize: 20, total: 5, items });

    expect(result).toEqual({
      pagination: { page: 1, pageSize: 20, total: 5 },
      items: [
        {
          id: 2,
          triggeredAt: "2026-07-04T06:00:00.000Z",
          outcome: "injected",
          thought: "想翻翻那篇文章",
          runtimeKey: "root-agent",
          createdAt: "2026-07-04T06:00:01.000Z",
        },
        {
          id: 1,
          triggeredAt: "2026-07-04T05:50:00.000Z",
          outcome: "empty",
          thought: "",
          runtimeKey: "root-agent",
          createdAt: "2026-07-04T05:50:00.000Z",
        },
      ],
    });
  });
});
