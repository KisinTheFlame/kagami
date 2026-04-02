import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { StoryService } from "../../application/story.service.js";
import { validateStoryMarkdown } from "../../domain/story-markdown.js";

export const REWRITE_STORY_TOOL_NAME = "rewrite_story";

const RewriteStoryArgumentsSchema = z.object({
  storyId: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
});

export class RewriteStoryTool extends ZodToolComponent<typeof RewriteStoryArgumentsSchema> {
  public readonly name = REWRITE_STORY_TOOL_NAME;
  public readonly description =
    "当最新一批消息是在延续已有叙事时，整条重写该 story 的当前 Markdown。";
  public readonly parameters = {
    type: "object",
    properties: {
      storyId: { type: "string", description: "需要重写的 story id。" },
      markdown: {
        type: "string",
        description:
          "重写后的完整 story Markdown，必须严格符合固定模板：`# 标题`、`- 时间：`、`- 场景：`、`- 人物：`、`- 影响：`、空行、`起因：`、`经过：`、有序列表、`结果：`。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = RewriteStoryArgumentsSchema;
  private readonly storyService: StoryService;
  private readonly sourceMessageSeqStart: number;
  private readonly sourceMessageSeqEnd: number;

  public constructor({
    storyService,
    sourceMessageSeqStart,
    sourceMessageSeqEnd,
  }: {
    storyService: StoryService;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }) {
    super();
    this.storyService = storyService;
    this.sourceMessageSeqStart = sourceMessageSeqStart;
    this.sourceMessageSeqEnd = sourceMessageSeqEnd;
  }

  protected async executeTyped(
    input: z.infer<typeof RewriteStoryArgumentsSchema>,
  ): Promise<string> {
    const validation = validateStoryMarkdown(input.markdown);
    if (!validation.ok) {
      return JSON.stringify({
        ok: false,
        error: "INVALID_STORY_MARKDOWN",
        details: validation.errors,
      });
    }

    const story = await this.storyService.rewrite({
      storyId: input.storyId,
      markdown: validation.normalizedMarkdown,
      sourceMessageSeqStart: this.sourceMessageSeqStart,
      sourceMessageSeqEnd: this.sourceMessageSeqEnd,
    });

    return JSON.stringify({
      ok: true,
      storyId: story.id,
    });
  }
}
