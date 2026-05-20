import type { Queue } from "@kagami/agent-runtime";
import type { AgentContext } from "../../../runtime/context/agent-context.js";
import type { Event, StoryRecallStoryPayload } from "../../../runtime/event/event.js";
import type { LlmClient } from "../../../../llm/client.js";
import type { LlmMessage, Tool } from "../../../../llm/types.js";
import { AppLogger } from "../../../../logger/logger.js";
import type { StoryRecallService } from "../application/story-recall.service.js";

const logger = new AppLogger({ source: "agent.story-recall" });

const QUERY_GENERATION_INSTRUCTION = [
  "<system_instruction>",
  "请根据当前对话上下文，调用 search_memory 工具搜索可能相关的历史记忆。",
  "生成一个能捕捉当前话题核心的搜索查询。",
  "</system_instruction>",
].join("\n");

export type StoryRecallSchedulerDeps = {
  llmClient: LlmClient;
  storyRecallService: StoryRecallService;
  agentContext: AgentContext;
  eventQueue: Queue<Event>;
  availableTools: Tool[];
  topK: number;
  scoreThreshold: number;
};

/**
 * StoryRecallScheduler：单例后台调度器，串行执行 story recall。
 *
 * 调度语义（trailing coalescing）：
 * - trigger() 时若当前没有在跑，立刻启动一次；
 * - trigger() 时若已经在跑，把 pendingRerun 置为 true（不论触发多少次只追加一次）；
 * - 当前任务结束后，若 pendingRerun 为 true 则立刻再跑一次。
 *
 * 一次成功跑出非空结果时，会把召回到的故事以 StoryRecallCompletedEvent
 * 形式塞入主 Agent 的事件队列，session 路由后追加到上下文并触发新一轮 round。
 * 召回结果为空时不入队事件，避免无意义的唤醒。
 *
 * 去重：injectedStoryIds 跨任务保留，避免反复把同一条故事推给主 Agent。
 * onContextCompacted / onAfterReset 会清空。
 */
export class StoryRecallScheduler {
  private readonly llmClient: LlmClient;
  private readonly storyRecallService: StoryRecallService;
  private readonly agentContext: AgentContext;
  private readonly eventQueue: Queue<Event>;
  private readonly availableTools: Tool[];
  private readonly topK: number;
  private readonly scoreThreshold: number;

  private readonly injectedStoryIds = new Set<string>();
  private running = false;
  private pendingRerun = false;

  public constructor(deps: StoryRecallSchedulerDeps) {
    this.llmClient = deps.llmClient;
    this.storyRecallService = deps.storyRecallService;
    this.agentContext = deps.agentContext;
    this.eventQueue = deps.eventQueue;
    this.availableTools = deps.availableTools;
    this.topK = deps.topK;
    this.scoreThreshold = deps.scoreThreshold;
  }

  public trigger(): void {
    if (this.running) {
      this.pendingRerun = true;
      return;
    }

    this.running = true;
    void this.runLoop();
  }

  public onContextCompacted(): void {
    this.injectedStoryIds.clear();
  }

  public onAfterReset(): void {
    this.injectedStoryIds.clear();
    this.pendingRerun = false;
  }

  private async runLoop(): Promise<void> {
    try {
      while (true) {
        await this.runOnce();
        if (!this.pendingRerun) {
          break;
        }
        this.pendingRerun = false;
      }
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    try {
      await this.performRecall();
    } catch (error) {
      logger.warn("Story recall failed; skipping", {
        event: "agent.story_recall.failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async performRecall(): Promise<void> {
    const snapshot = await this.agentContext.getSnapshot();

    const query = await this.generateQuery(snapshot);
    if (!query || query.trim().length < 2) {
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

    if (filtered.length === 0) {
      return;
    }

    const stories: StoryRecallStoryPayload[] = filtered.map(r => ({
      id: r.story.id,
      markdown: r.story.markdown,
      createdAt: r.story.createdAt,
    }));

    this.eventQueue.enqueue({
      type: "story_recall_completed",
      data: { stories },
    });

    for (const r of filtered) {
      this.injectedStoryIds.add(r.story.id);
    }

    logger.info("Story recall results enqueued", {
      event: "agent.story_recall.enqueued",
      count: filtered.length,
      storyIds: filtered.map(r => r.story.id),
      scores: filtered.map(r => r.score.toFixed(3)),
    });
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
        toolChoice: { tool_name: "search_memory" },
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
}
