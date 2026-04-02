import { describe, expect, it, vi } from "vitest";
import { CreateStoryTool } from "../../src/agent/capabilities/story/task-agent/tools/create-story.tool.js";
import { RewriteStoryTool } from "../../src/agent/capabilities/story/task-agent/tools/rewrite-story.tool.js";
import {
  formatStoryMarkdown,
  type StoryContent,
  validateStoryMarkdown,
} from "../../src/agent/capabilities/story/domain/story-markdown.js";
import type { StoryService } from "../../src/agent/capabilities/story/application/story.service.js";

const STORY_CONTENT: StoryContent = {
  title: "权限交接吐槽",
  time: "今天",
  scene: "群聊",
  people: ["Alice"],
  cause: "继续吐槽流程",
  process: ["提到 CEO 审批"],
  result: "觉得流程离谱",
  impact: "审批链路继续拖慢交接",
};

describe("story markdown", () => {
  it("should parse canonical markdown", () => {
    const markdown = formatStoryMarkdown(STORY_CONTENT);

    expect(validateStoryMarkdown(markdown)).toEqual({
      ok: true,
      story: STORY_CONTENT,
      normalizedMarkdown: markdown,
    });
  });

  it("should reject missing required fields and invalid process blocks", () => {
    const result = validateStoryMarkdown(
      [
        "# 权限交接吐槽",
        "- 时间：",
        "- 场景：群聊",
        "- 人物：Alice",
        "- 影响：",
        "",
        "起因：",
        "经过：",
        "补充说明：这里不是列表",
        "结果：",
        "额外内容",
      ].join("\n"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected invalid markdown");
    }

    expect(result.errors).toContain("“时间：”不能为空。");
    expect(result.errors).toContain("“影响：”不能为空。");
    expect(result.errors).toContain("“起因：”不能为空。");
    expect(result.errors).toContain("“经过：”后的第 1 行必须是 `1. <内容>`。");
    expect(result.errors).toContain("“结果：”不能为空。");
    expect(result.errors).toContain("出现未允许的额外内容：`额外内容`。");
  });

  it("should reject invalid markdown in create_story tool", async () => {
    const storyService = {
      create: vi.fn(),
      rewrite: vi.fn(),
    } as unknown as StoryService;
    const tool = new CreateStoryTool({
      storyService,
      sourceMessageSeqStart: 1,
      sourceMessageSeqEnd: 2,
    });

    const result = await tool.execute(
      {
        markdown: "# 标题\n- 时间：\n- 场景：\n- 人物：\n- 影响：\n\n起因：\n经过：\n结果：",
      },
      {},
    );

    expect(JSON.parse(result.content)).toEqual({
      ok: false,
      error: "INVALID_STORY_MARKDOWN",
      details: expect.arrayContaining([
        "“时间：”不能为空。",
        "“影响：”不能为空。",
        "“起因：”不能为空。",
        "“经过：”后至少需要 1 条有序列表项。",
        "“结果：”不能为空。",
      ]),
    });
  });

  it("should pass normalized markdown to rewrite_story tool", async () => {
    const storyService = {
      create: vi.fn(),
      rewrite: vi.fn().mockResolvedValue({
        id: "story-1",
      }),
    } as unknown as StoryService;
    const tool = new RewriteStoryTool({
      storyService,
      sourceMessageSeqStart: 3,
      sourceMessageSeqEnd: 4,
    });
    const markdown = formatStoryMarkdown(STORY_CONTENT);

    await tool.execute(
      {
        storyId: "story-1",
        markdown,
      },
      {},
    );

    expect(
      (storyService.rewrite as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({
      storyId: "story-1",
      markdown,
      sourceMessageSeqStart: 3,
      sourceMessageSeqEnd: 4,
    });
  });
});
