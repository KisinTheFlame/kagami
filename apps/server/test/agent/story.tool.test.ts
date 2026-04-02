import { describe, expect, it, vi } from "vitest";
import { CreateStoryTool } from "../../src/agent/capabilities/story/task-agent/tools/create-story.tool.js";
import { RewriteStoryTool } from "../../src/agent/capabilities/story/task-agent/tools/rewrite-story.tool.js";
import { formatStoryMarkdown } from "../../src/agent/capabilities/story/domain/story-markdown.js";

const STORY_MARKDOWN = formatStoryMarkdown({
  title: "权限交接吐槽",
  time: "今天",
  scene: "群聊",
  people: ["Alice"],
  cause: "继续吐槽流程",
  process: ["提到 CEO 审批"],
  result: "觉得流程离谱",
  impact: "审批链路继续拖慢交接",
});

describe("story tools", () => {
  it("should create story with normalized markdown", async () => {
    const storyService = {
      create: vi.fn().mockResolvedValue({
        id: "story-1",
      }),
      rewrite: vi.fn(),
    };
    const tool = new CreateStoryTool({
      storyService: storyService as never,
      sourceMessageSeqStart: 11,
      sourceMessageSeqEnd: 12,
    });

    const result = await tool.execute(
      {
        markdown: `${STORY_MARKDOWN}\n`,
      },
      {},
    );

    expect(storyService.create).toHaveBeenCalledWith({
      markdown: STORY_MARKDOWN,
      sourceMessageSeqStart: 11,
      sourceMessageSeqEnd: 12,
    });
    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      storyId: "story-1",
    });
  });

  it("should reject invalid markdown in rewrite tool with detailed errors", async () => {
    const storyService = {
      create: vi.fn(),
      rewrite: vi.fn(),
    };
    const tool = new RewriteStoryTool({
      storyService: storyService as never,
      sourceMessageSeqStart: 21,
      sourceMessageSeqEnd: 25,
    });

    const result = await tool.execute(
      {
        storyId: "story-1",
        markdown: [
          "# 权限交接吐槽",
          "- 时间：今天",
          "- 场景：群聊",
          "- 人物：Alice",
          "- 影响：",
          "",
          "起因：继续吐槽流程",
          "经过：",
          "结果：觉得流程离谱",
        ].join("\n"),
      },
      {},
    );

    expect(storyService.rewrite).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_STORY_MARKDOWN",
    });
    expect(JSON.parse(result.content).details).toContain("“影响：”不能为空。");
    expect(JSON.parse(result.content).details).toContain("“经过：”后至少需要 1 条有序列表项。");
  });
});
