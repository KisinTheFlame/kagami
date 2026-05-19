import type { LoopAgentExtension } from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../../../runtime/root-agent/root-agent-runtime.js";
import type { StoryRecallService } from "../application/story-recall.service.js";
import { AppLogger } from "../../../../logger/logger.js";

const logger = new AppLogger({ source: "agent.story-recall" });

const QUERY_GENERATION_INSTRUCTION = [
  "<system_instruction>",
  "请根据当前对话上下文，调用 search_memory 工具搜索可能相关的历史记忆。",
  "生成一个能捕捉当前话题核心的搜索查询。",
  "</system_instruction>",
].join("\n");

function formatRecallDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class StoryRecallExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly llmClient: LlmClient;
  private readonly storyRecallService: StoryRecallService;
  private readonly availableTools: Tool[];
  private readonly topK: number;
  private readonly scoreThreshold: number;

  private readonly injectedStoryIds = new Set<string>();
  private lastRecallMessageCount = 0;

  public constructor({
    llmClient,
    storyRecallService,
    availableTools,
    topK,
    scoreThreshold,
  }: {
    llmClient: LlmClient;
    storyRecallService: StoryRecallService;
    availableTools: Tool[];
    topK: number;
    scoreThreshold: number;
  }) {
    this.llmClient = llmClient;
    this.storyRecallService = storyRecallService;
    this.availableTools = availableTools;
    this.topK = topK;
    this.scoreThreshold = scoreThreshold;
  }

  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    try {
      await this.performRecall(context);
    } catch (error) {
      logger.warn("Story recall failed; skipping", {
        event: "agent.story_recall.failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public onContextCompacted(): void {
    this.injectedStoryIds.clear();
    this.lastRecallMessageCount = 0;
  }

  public onAfterReset(): void {
    this.injectedStoryIds.clear();
    this.lastRecallMessageCount = 0;
  }

  private async performRecall(context: RootLoopExtensionContext): Promise<void> {
    const snapshot = await context.host.getContextSnapshot();

    if (snapshot.messages.length === this.lastRecallMessageCount) {
      return;
    }

    const query = await this.generateQuery(snapshot);
    if (!query || query.trim().length < 2) {
      this.lastRecallMessageCount = snapshot.messages.length;
      return;
    }

    logger.info("Story recall query generated", {
      event: "agent.story_recall.query_generated",
      queryText: query,
    });

    const results = await this.storyRecallService.search({
      query,
      topK: this.topK,
    });

    const filtered = results.filter(
      r => r.score >= this.scoreThreshold && !this.injectedStoryIds.has(r.story.id),
    );

    if (filtered.length > 0) {
      const recallMessage = this.formatRecallMessage(filtered);
      await context.host.appendMessages([recallMessage]);

      for (const r of filtered) {
        this.injectedStoryIds.add(r.story.id);
      }

      logger.info("Story recall results injected", {
        event: "agent.story_recall.injected",
        count: filtered.length,
        storyIds: filtered.map(r => r.story.id),
        scores: filtered.map(r => r.score.toFixed(3)),
      });
    }

    this.lastRecallMessageCount = snapshot.messages.length;
  }

  private async generateQuery(snapshot: {
    systemPrompt: string;
    messages: LlmMessage[];
  }): Promise<string | null> {
    const messages: LlmMessage[] = [
      ...snapshot.messages,
      { role: "user" as const, content: QUERY_GENERATION_INSTRUCTION },
    ];

    const response = await this.llmClient.chat(
      {
        system: snapshot.systemPrompt,
        messages,
        tools: this.availableTools,
        toolChoice: "auto",
      },
      { usage: "agent" },
    );

    const toolCall = response.message.toolCalls?.[0];
    if (!toolCall || toolCall.name !== "search_memory") {
      return null;
    }

    const query = toolCall.arguments?.query;
    if (typeof query !== "string") {
      return null;
    }

    return query;
  }

  private formatRecallMessage(
    results: Awaited<ReturnType<StoryRecallService["search"]>>,
  ): LlmMessage {
    const parts = results.map(r => {
      const date = formatRecallDate(r.story.createdAt);
      return [`你想起了一件发生在 ${date} 的事情：`, "", r.story.markdown].join("\n");
    });

    const content = ["<story_recall>", ...parts, "</story_recall>"].join("\n");

    return { role: "user", content };
  }
}
