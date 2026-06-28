import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { StoryService } from "../../application/story.service.js";
import { validateStoryMarkdown } from "../../domain/story-markdown.js";

export const CREATE_STORY_TOOL_NAME = "create_story";

const CreateStoryArgumentsSchema = z.object({
  markdown: z.string().trim().min(1),
});

export class CreateStoryTool extends ZodToolComponent<typeof CreateStoryArgumentsSchema> {
  public readonly name = CREATE_STORY_TOOL_NAME;
  public readonly description = "当最新一批消息形成了一条全新的叙事时，创建一条新的 story。";
  public readonly parameters = {
    type: "object",
    properties: {
      markdown: {
        type: "string",
        description:
          "完整 story Markdown，必须严格符合固定模板：`# 标题`、`- 时间：`、`- 场景：`、`- 人物：`、`- 影响：`、空行、`起因：`、`经过：`、有序列表、`结果：`。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = CreateStoryArgumentsSchema;
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

  protected async executeTyped(input: z.infer<typeof CreateStoryArgumentsSchema>): Promise<string> {
    const validation = validateStoryMarkdown(input.markdown);
    if (!validation.ok) {
      return JSON.stringify({
        ok: false,
        error: "INVALID_STORY_MARKDOWN",
        details: validation.errors,
      });
    }

    const story = await this.storyService.create({
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
