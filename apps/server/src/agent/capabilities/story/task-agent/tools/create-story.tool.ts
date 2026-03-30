import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { StorySchema } from "../../domain/story.js";
import { StoryService } from "../../application/story.service.js";

export const CREATE_STORY_TOOL_NAME = "create_story";

const CreateStoryArgumentsSchema = StorySchema;

export class CreateStoryTool extends ZodToolComponent<typeof CreateStoryArgumentsSchema> {
  public readonly name = CREATE_STORY_TOOL_NAME;
  public readonly description = "当最新一批消息形成了一条全新的叙事时，创建一条新的 story。";
  public readonly parameters = {
    type: "object",
    properties: {
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
    const story = await this.storyService.create({
      payload: input,
      sourceMessageSeqStart: this.sourceMessageSeqStart,
      sourceMessageSeqEnd: this.sourceMessageSeqEnd,
    });

    return JSON.stringify({
      ok: true,
      storyId: story.id,
    });
  }
}
