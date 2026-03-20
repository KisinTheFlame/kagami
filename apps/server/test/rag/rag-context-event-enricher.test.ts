import { describe, expect, it, vi } from "vitest";
import { RagContextEventEnricher } from "../../src/rag/rag-context-event-enricher.js";
import type { RagQueryPlannerService } from "../../src/rag/rag-query-planner.service.js";

describe("RagContextEventEnricher", () => {
  it("should enrich only napcat group message events", async () => {
    const ragQueryPlanner = {
      plan: vi.fn().mockResolvedValue([
        {
          role: "user",
          content: "<memory_history_message>\n时间：2026-03-11 10:00:00\n</memory_history_message>",
        },
      ]),
    } as unknown as RagQueryPlannerService;
    const enricher = new RagContextEventEnricher({
      ragQueryPlanner,
    });

    await expect(
      enricher.enrichAfterEvents({
        events: [
          {
            type: "napcat_group_message",
            groupId: "123456",
            userId: "654321",
            nickname: "测试昵称",
            rawMessage: "hello",
            messageId: 1001,
            time: 1710000000,
          },
        ],
        snapshot: {
          systemPrompt: "system-prompt",
          messages: [
            {
              role: "user",
              content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
            },
          ],
        },
      }),
    ).resolves.toEqual([
      {
        role: "user",
        content: "<memory_history_message>\n时间：2026-03-11 10:00:00\n</memory_history_message>",
      },
    ]);
    expect(ragQueryPlanner.plan).toHaveBeenCalledWith({
      groupId: "123456",
      contextMessages: [
        {
          role: "user",
          content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
        },
      ],
    });
  });

  it("should degrade to empty messages when planner fails", async () => {
    const ragQueryPlanner = {
      plan: vi.fn().mockRejectedValue(new Error("planner failed")),
    } as unknown as RagQueryPlannerService;
    const enricher = new RagContextEventEnricher({
      ragQueryPlanner,
    });

    await expect(
      enricher.enrichAfterEvents({
        events: [
          {
            type: "napcat_group_message",
            groupId: "123456",
            userId: "654321",
            nickname: "测试昵称",
            rawMessage: "hello",
            messageId: 1001,
            time: 1710000000,
          },
        ],
        snapshot: {
          systemPrompt: "system-prompt",
          messages: [
            {
              role: "user",
              content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
            },
          ],
        },
      }),
    ).resolves.toEqual([]);
  });

  it("should use the last group message event in the batch", async () => {
    const ragQueryPlanner = {
      plan: vi.fn().mockResolvedValue([]),
    } as unknown as RagQueryPlannerService;
    const enricher = new RagContextEventEnricher({
      ragQueryPlanner,
    });

    await expect(
      enricher.enrichAfterEvents({
        events: [
          {
            type: "napcat_group_message",
            groupId: "group-1",
            userId: "u1",
            nickname: "A",
            rawMessage: "first",
            messageId: 1001,
            time: 1710000000,
          },
          {
            type: "napcat_group_message",
            groupId: "group-2",
            userId: "u2",
            nickname: "B",
            rawMessage: "second",
            messageId: 1002,
            time: 1710000001,
          },
        ],
        snapshot: {
          systemPrompt: "system-prompt",
          messages: [],
        },
      }),
    ).resolves.toEqual([]);

    expect(ragQueryPlanner.plan).toHaveBeenCalledWith({
      groupId: "group-2",
      contextMessages: [],
    });
  });
});
