import { describe, expect, it, vi } from "vitest";
import { formatStoryMarkdown } from "../../src/agent/capabilities/story/domain/story-markdown.js";
import { DefaultStoryQueryService } from "../../src/ops/application/story-query.impl.service.js";

describe("DefaultStoryQueryService", () => {
  it("should return markdown and derived summary fields for story list items", async () => {
    const markdown = formatStoryMarkdown({
      title: "权限交接吐槽",
      time: "今天",
      scene: "群聊",
      people: ["Alice"],
      cause: "继续吐槽流程",
      process: ["提到 CEO 审批"],
      result: "觉得流程离谱",
      impact: "审批链路继续拖慢交接",
    });
    const service = new DefaultStoryQueryService({
      storyDao: {
        countAll: vi.fn().mockResolvedValue(1),
        listPage: vi.fn().mockResolvedValue([
          {
            id: "story-1",
            markdown,
            content: {
              title: "权限交接吐槽",
              time: "今天",
              scene: "群聊",
              people: ["Alice"],
              cause: "继续吐槽流程",
              process: ["提到 CEO 审批"],
              result: "觉得流程离谱",
              impact: "审批链路继续拖慢交接",
            },
            sourceMessageSeqStart: 1,
            sourceMessageSeqEnd: 3,
            createdAt: new Date("2026-04-02T10:00:00.000Z"),
            updatedAt: new Date("2026-04-02T10:10:00.000Z"),
          },
        ]),
        create: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findManyByIds: vi.fn(),
      },
      storyRecallService: {
        search: vi.fn(),
      } as never,
    });

    const response = await service.queryList({
      page: 1,
      pageSize: 20,
    });

    expect(response.items).toEqual([
      {
        id: "story-1",
        markdown,
        title: "权限交接吐槽",
        time: "今天",
        scene: "群聊",
        people: ["Alice"],
        impact: "审批链路继续拖慢交接",
        sourceMessageSeqStart: 1,
        sourceMessageSeqEnd: 3,
        createdAt: "2026-04-02T10:00:00.000Z",
        updatedAt: "2026-04-02T10:10:00.000Z",
        score: null,
        matchedKinds: [],
      },
    ]);
  });
});
