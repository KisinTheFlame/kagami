import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { StorySchema } from "../../domain/story.js";
import { StoryService } from "../../application/story.service.js";

export const REWRITE_STORY_TOOL_NAME = "rewrite_story";

const RewriteStoryArgumentsSchema = StorySchema.extend({
  storyId: z.string().trim().min(1),
});

export class RewriteStoryTool extends ZodToolComponent<typeof RewriteStoryArgumentsSchema> {
  public readonly name = REWRITE_STORY_TOOL_NAME;
  public readonly description = "当最新一批消息是在延续已有叙事时，整条重写该 story 的当前 JSON。";
  public readonly parameters = {
    type: "object",
    properties: {
      storyId: { type: "string", description: "需要重写的 story id。" },
      title: { type: "string", description: "叙事标题。" },
      time: { type: "string", description: "叙事发生时间。" },
      scene: { type: "string", description: "叙事发生场景。" },
      people: { type: "array", items: { type: "string" }, description: "相关人物。" },
      cause: { type: "string", description: "起因。" },
      process: { type: "array", items: { type: "string" }, description: "经过。" },
      result: { type: "string", description: "结果。" },
      status: { type: "string", description: "当前状态。" },
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
    const { storyId, ...payload } = input;
    const story = await this.storyService.rewrite({
      storyId,
      payload,
      sourceMessageSeqStart: this.sourceMessageSeqStart,
      sourceMessageSeqEnd: this.sourceMessageSeqEnd,
    });

    return JSON.stringify({
      ok: true,
      storyId: story.id,
    });
  }
}
