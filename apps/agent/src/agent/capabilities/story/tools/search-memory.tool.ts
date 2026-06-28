import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { StoryRecallService } from "../application/story-recall.service.js";

export const SEARCH_MEMORY_TOOL_NAME = "search_memory";

const SearchMemoryArgumentsSchema = z.object({
  query: z.string().trim().min(1),
});

export class SearchMemoryTool extends ZodToolComponent<typeof SearchMemoryArgumentsSchema> {
  public readonly name = SEARCH_MEMORY_TOOL_NAME;
  public readonly description =
    "当需要回忆之前经历过的人、事、新闻、结论或持续话题时，先搜索长期 story 记忆。";
  public readonly parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "用于回忆 story 的自然语言查询。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SearchMemoryArgumentsSchema;
  private readonly storyRecallService: StoryRecallService;
  private readonly topK: number;

  public constructor({
    storyRecallService,
    topK,
  }: {
    storyRecallService: StoryRecallService;
    topK: number;
  }) {
    super();
    this.storyRecallService = storyRecallService;
    this.topK = topK;
  }

  protected async executeTyped(
    input: z.infer<typeof SearchMemoryArgumentsSchema>,
  ): Promise<string> {
    const results = await this.storyRecallService.search({
      query: input.query,
      topK: this.topK,
    });

    return renderSearchMemoryMarkdown(results);
  }
}

function renderSearchMemoryMarkdown(
  results: Awaited<ReturnType<StoryRecallService["search"]>>,
): string {
  if (results.length === 0) {
    return ["## Memory Search", "", "没有找到相关记忆。"].join("\n");
  }

  return [
    "## Memory Search",
    "",
    ...results.flatMap((result, index) => {
      return [
        `### ${index + 1}. ${result.story.content.title}`,
        `- storyId: \`${result.story.id}\``,
        `- score: \`${result.score.toFixed(3)}\``,
        `- matchedKinds: \`${result.matchedKinds.join(", ")}\``,
        "",
        result.story.markdown,
        "",
      ].filter(Boolean);
    }),
  ].join("\n");
}
