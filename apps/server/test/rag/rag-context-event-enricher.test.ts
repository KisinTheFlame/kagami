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
      enricher.enrichAfterEvent({
        event: {
          type: "napcat_group_message",
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "hello",
          messageId: 1001,
          time: 1710000000,
        },
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
      currentMessage: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
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
      enricher.enrichAfterEvent({
        event: {
          type: "napcat_group_message",
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "hello",
          messageId: 1001,
          time: 1710000000,
        },
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
});
