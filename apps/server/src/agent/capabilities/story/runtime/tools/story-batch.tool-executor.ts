import {
  ToolCatalog,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutor,
  type ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../../llm/types.js";
import { StoryService } from "../../application/story.service.js";
import {
  CreateStoryTool,
  CREATE_STORY_TOOL_NAME,
} from "../../task-agent/tools/create-story.tool.js";
import {
  FinishStoryBatchTool,
  FINISH_STORY_BATCH_TOOL_NAME,
} from "../../task-agent/tools/finish-story-batch.tool.js";
import {
  RewriteStoryTool,
  REWRITE_STORY_TOOL_NAME,
} from "../../task-agent/tools/rewrite-story.tool.js";
import type { StoryBatchSeqRange } from "../story-batch-preparer.js";

export function createStoryBatchToolDefinitions(input: {
  storyService: StoryService;
}): ToolDefinition[] {
  return new ToolCatalog([
    new CreateStoryTool({
      storyService: input.storyService,
      sourceMessageSeqStart: 0,
      sourceMessageSeqEnd: 0,
    }),
    new RewriteStoryTool({
      storyService: input.storyService,
      sourceMessageSeqStart: 0,
      sourceMessageSeqEnd: 0,
    }),
    new FinishStoryBatchTool(),
  ])
    .pick([CREATE_STORY_TOOL_NAME, REWRITE_STORY_TOOL_NAME, FINISH_STORY_BATCH_TOOL_NAME])
    .definitions();
}

type StoryBatchToolExecutorDeps = {
  storyService: StoryService;
  toolDefinitions: ToolDefinition[];
  getPendingBatchSeqRange: () => StoryBatchSeqRange | null;
};

/**
 * 把 LLM 选中的工具调用映射到带有"当前批次 seq 范围"上下文的 CreateStory / RewriteStory / FinishStoryBatch 工具集。
 * 每次 execute 都重建 ToolCatalog，确保 sourceMessageSeqStart/End 取的是当下 pendingBatch 的 seq。
 */
export class StoryBatchToolExecutor implements ToolExecutor<LlmMessage> {
  private readonly storyService: StoryService;
  private readonly toolDefinitions: ToolDefinition[];
  private readonly getPendingBatchSeqRange: () => StoryBatchSeqRange | null;

  public constructor({
    storyService,
    toolDefinitions,
    getPendingBatchSeqRange,
  }: StoryBatchToolExecutorDeps) {
    this.storyService = storyService;
    this.toolDefinitions = toolDefinitions;
    this.getPendingBatchSeqRange = getPendingBatchSeqRange;
  }

  public definitions(): ToolDefinition[] {
    return this.toolDefinitions;
  }

  public getKind(name: string): "business" | "control" | null {
    switch (name) {
      case CREATE_STORY_TOOL_NAME:
      case REWRITE_STORY_TOOL_NAME:
        return "business";
      case FINISH_STORY_BATCH_TOOL_NAME:
        return "control";
      default:
        return null;
    }
  }

  public async execute(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolContext<LlmMessage>,
  ): Promise<ToolSetExecutionResult> {
    const pendingBatch = this.getPendingBatchSeqRange();
    const sourceMessageSeqStart = pendingBatch?.firstSeq ?? 0;
    const sourceMessageSeqEnd = pendingBatch?.lastSeq ?? 0;
    const toolSet = new ToolCatalog([
      new CreateStoryTool({
        storyService: this.storyService,
        sourceMessageSeqStart,
        sourceMessageSeqEnd,
      }),
      new RewriteStoryTool({
        storyService: this.storyService,
        sourceMessageSeqStart,
        sourceMessageSeqEnd,
      }),
      new FinishStoryBatchTool(),
    ]).pick([CREATE_STORY_TOOL_NAME, REWRITE_STORY_TOOL_NAME, FINISH_STORY_BATCH_TOOL_NAME]);

    return await toolSet.execute(name, argumentsValue, context);
  }
}
