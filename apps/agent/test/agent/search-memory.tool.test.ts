import { describe, expect, it, vi } from "vitest";
import { SearchMemoryTool } from "../../src/agent/capabilities/story/tools/search-memory.tool.js";
import { formatStoryMarkdown } from "../../src/agent/capabilities/story/domain/story-markdown.js";

describe("search_memory tool", () => {
  it("should render story markdown in search results", async () => {
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
    const storyRecallService = {
      search: vi.fn().mockResolvedValue([
        {
          story: {
            id: "story-1",
            markdown,
            content: {
              title: "权限交接吐槽",
            },
          },
          score: 0.9,
          matchedKinds: ["overview"],
        },
      ]),
    };
    const tool = new SearchMemoryTool({
      storyRecallService: storyRecallService as never,
      topK: 3,
    });

    const result = await tool.execute(
      {
        query: "权限交接",
      },
      {},
    );

    expect(result.content).toContain("## Memory Search");
    expect(result.content).toContain("- storyId: `story-1`");
    expect(result.content).toContain(markdown);
  });
});
