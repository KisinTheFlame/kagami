import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContextManager } from "../../src/agent/context-manager.impl.manager.js";
import type { RagQueryPlannerService } from "../../src/rag/query-planner.service.js";

describe("DefaultAgentContextManager", () => {
  it("should insert memory message after the current group message", async () => {
    const ragQueryPlanner = {
      plan: vi
        .fn()
        .mockResolvedValue(
          [
            "<memory_history_message>",
            "时间：2026-03-11 10:00:00",
            "</memory_history_message>",
          ].join("\n"),
        ),
    } as unknown as RagQueryPlannerService;
    const manager = new DefaultAgentContextManager({
      ragQueryPlanner,
    });

    await manager.pushGroupMessageEvent({
      type: "napcat_group_message",
      groupId: "123456",
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: "hello",
      messageId: 1001,
      time: 1710000000,
    });

    expect(manager.getMessages()).toEqual([
      {
        role: "user",
        content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
      },
      {
        role: "user",
        content: [
          "<memory_history_message>",
          "时间：2026-03-11 10:00:00",
          "</memory_history_message>",
        ].join("\n"),
      },
    ]);
  });

  it("should skip memory insertion when planner does not search", async () => {
    const ragQueryPlanner = {
      plan: vi.fn().mockResolvedValue(null),
    } as unknown as RagQueryPlannerService;
    const manager = new DefaultAgentContextManager({
      ragQueryPlanner,
    });

    await manager.pushGroupMessageEvent({
      type: "napcat_group_message",
      groupId: "123456",
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: "hello",
      messageId: 1001,
      time: 1710000000,
    });

    expect(manager.getMessages()).toEqual([
      {
        role: "user",
        content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
      },
    ]);
  });
});
