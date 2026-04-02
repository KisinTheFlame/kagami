import { describe, expect, it, vi } from "vitest";
import { StoryLoopAgent } from "../../src/agent/capabilities/story/runtime/story-agent.runtime.js";
import {
  formatStoryMarkdown,
  type StoryContent,
} from "../../src/agent/capabilities/story/domain/story-markdown.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { createUserMessage } from "../../src/agent/runtime/context/context-message-factory.js";
import { BizError } from "../../src/common/errors/biz-error.js";
import type { StoryService } from "../../src/agent/capabilities/story/application/story.service.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload, LlmMessage } from "../../src/llm/types.js";
import type { MetricService } from "../../src/metric/application/metric.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

function createMetricServiceMock(): MetricService {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

const DEFAULT_STORY_CONTENT: StoryContent = {
  title: "权限交接吐槽",
  time: "今天",
  scene: "群聊",
  people: ["Alice"],
  cause: "继续吐槽流程",
  process: ["提到 CEO 审批"],
  result: "觉得流程离谱",
  impact: "审批链路继续拖慢交接",
};

function createStoryMarkdown(content: StoryContent = DEFAULT_STORY_CONTENT): string {
  return formatStoryMarkdown(content);
}

function createStoryRecord(overrides?: Partial<StoryContent>) {
  const content = {
    ...DEFAULT_STORY_CONTENT,
    ...overrides,
  } satisfies StoryContent;

  return {
    id: "story-1",
    markdown: createStoryMarkdown(content),
    content,
    sourceMessageSeqStart: 1,
    sourceMessageSeqEnd: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("StoryLoopAgent", () => {
  it("processes a batch when pending messages reach the batch threshold", async () => {
    const create = vi.fn().mockResolvedValue({
      ...createStoryRecord(),
      sourceMessageSeqStart: 11,
      sourceMessageSeqEnd: 12,
    });
    const save = vi.fn().mockResolvedValue(undefined);
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient([
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-1",
              name: "create_story",
              arguments: {
                markdown: createStoryMarkdown(),
              },
            },
          ],
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-2",
              name: "finish_story_batch",
              arguments: {},
            },
          ],
        },
      ]).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 12,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "说要给 CEO 审批",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 11,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "又在吐槽权限交接",
            },
            createdAt: new Date(),
          },
          {
            seq: 12,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "说要给 CEO 审批",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save,
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create,
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 2,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      sleep: vi.fn(),
    });

    const didProcess = await runtime.runOnce();

    expect(didProcess).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("processes a batch on idle flush even when pending messages are below threshold", async () => {
    const finishOnlyRuntime = new StoryLoopAgent({
      llmClient: createStubLlmClient([
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-1",
              name: "finish_story_batch",
              arguments: {},
            },
          ],
        },
      ]).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 1,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "a",
          },
          createdAt: new Date("2026-03-31T10:00:00.000Z"),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "a",
            },
            createdAt: new Date("2026-03-31T10:00:00.000Z"),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 10,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      now: () => new Date("2026-03-31T10:10:00.000Z"),
      sleep: vi.fn(),
    });

    const didProcess = await finishOnlyRuntime.runOnce();

    expect(didProcess).toBe(true);
  });

  it("rewrites an existing story when the model requests it", async () => {
    const rewrite = vi.fn().mockResolvedValue({
      ...createStoryRecord(),
      sourceMessageSeqStart: 1,
      sourceMessageSeqEnd: 21,
    });
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient([
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-1",
              name: "rewrite_story",
              arguments: {
                storyId: "story-1",
                markdown: createStoryMarkdown(),
              },
            },
          ],
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-2",
              name: "finish_story_batch",
              arguments: {},
            },
          ],
        },
      ]).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 21,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "这个话题还在继续",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 21,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "这个话题还在继续",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite,
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 1,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      sleep: vi.fn(),
    });

    await runtime.runOnce();

    expect(rewrite).toHaveBeenCalledOnce();
    expect(rewrite.mock.calls[0]?.[0]).toMatchObject({
      storyId: "story-1",
    });
  });

  it("passes ledger history to the story agent as a single user message", async () => {
    const llmClient = createStubLlmClient([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "finish_story_batch",
            arguments: {},
          },
        ],
      },
    ]);
    const runtime = new StoryLoopAgent({
      llmClient: llmClient.client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 3,
          runtimeKey: "root-agent",
          message: {
            role: "tool",
            toolCallId: "search-1",
            content: "找到了一条旧记忆",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "又在吐槽权限交接",
            },
            createdAt: new Date(),
          },
          {
            seq: 2,
            runtimeKey: "root-agent",
            message: {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "search-1",
                  name: "search_memory",
                  arguments: {
                    query: "权限交接",
                  },
                },
              ],
            },
            createdAt: new Date(),
          },
          {
            seq: 3,
            runtimeKey: "root-agent",
            message: {
              role: "tool",
              toolCallId: "search-1",
              content: "找到了一条旧记忆",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 3,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      sleep: vi.fn(),
    });

    await runtime.runOnce();

    expect(llmClient.chat).toHaveBeenCalledOnce();
    const request = llmClient.chat.mock.calls[0]?.[0];
    const userMessages =
      request?.messages.filter(
        (message: LlmMessage): message is Extract<LlmMessage, { role: "user" }> =>
          message.role === "user",
      ) ?? [];
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      role: "user",
    });
    expect(typeof userMessages[0]?.content).toBe("string");
    expect(userMessages[0]?.content).toContain("[1] user");
    expect(userMessages[0]?.content).toContain("又在吐槽权限交接");
    expect(userMessages[0]?.content).toContain("[2] assistant");
    expect(userMessages[0]?.content).toContain("工具调用：search_memory");
    expect(userMessages[0]?.content).toContain("[3] tool");
    expect(userMessages[0]?.content).toContain("找到了一条旧记忆");
    expect(userMessages[0]?.content).not.toContain("候选 story");
    expect(userMessages[0]?.content).not.toContain("重写对应 story");
  });

  it("restores story messages while keeping the current system prompt source", async () => {
    const snapshotRepository = {
      load: vi.fn().mockResolvedValue({
        runtimeKey: "story-agent",
        schemaVersion: 1,
        contextSnapshot: {
          messages: [
            {
              role: "assistant",
              content: "已处理旧批次",
              toolCalls: [],
            },
          ],
          systemPrompt: "legacy-story-prompt",
        },
        lastProcessedMessageSeq: 12,
      }),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient([]).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValue(0),
        findLatest: vi.fn().mockResolvedValue(null),
        listAfterSeq: vi.fn().mockResolvedValue([]),
      },
      snapshotRepository,
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 1,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPromptFactory: () => "fresh-story-prompt",
      }),
      sleep: vi.fn(),
    });

    await runtime.initialize();

    await expect(runtime.getContextSnapshot()).resolves.toEqual({
      systemPrompt: "fresh-story-prompt",
      messages: [
        {
          role: "assistant",
          content: "已处理旧批次",
          toolCalls: [],
        },
      ],
    });
  });

  it("exposes story dashboard snapshot with runtime state and recent context", async () => {
    const summarize = vi.fn().mockResolvedValue("累计 story 摘要");
    const metricService = createMetricServiceMock();
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "tool-call-1",
                name: "create_story",
                arguments: {
                  markdown: createStoryMarkdown(),
                },
              },
            ],
          },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "tool-call-2",
                name: "finish_story_batch",
                arguments: {},
              },
            ],
          },
        ],
        {
          totalTokens: 3,
        },
      ).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 1,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "又在吐槽权限交接",
          },
          createdAt: new Date("2026-03-31T10:00:00.000Z"),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "又在吐槽权限交接",
            },
            createdAt: new Date("2026-03-31T10:00:00.000Z"),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn().mockResolvedValue(createStoryRecord()),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: summarize,
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 2,
      batchSize: 1,
      idleFlushMs: 60_000,
      metricService,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      sleep: vi.fn(),
    });

    await runtime.runOnce();

    const snapshot = await runtime.getDashboardSnapshot();

    expect(snapshot.initialized).toBe(true);
    expect(snapshot.loopState).toBe("idle");
    expect(snapshot.lastError).toBeNull();
    expect(snapshot.lastActivityAt).toBeInstanceOf(Date);
    expect(snapshot.lastRoundCompletedAt).toBeInstanceOf(Date);
    expect(snapshot.lastCompactionAt).toBeInstanceOf(Date);
    expect(snapshot.lastToolCall).toEqual({
      name: "finish_story_batch",
      argumentsPreview: "{}",
      updatedAt: expect.any(Date),
    });
    expect(snapshot.lastLlmCall).toEqual({
      provider: "openai",
      model: "gpt-test",
      assistantContentPreview: "",
      toolCallNames: ["finish_story_batch"],
      totalTokens: 3,
      updatedAt: expect.any(Date),
    });
    expect(snapshot.story).toEqual({
      lastProcessedMessageSeq: 1,
      pendingMessageCount: 0,
      pendingBatch: null,
      batchSize: 1,
      idleFlushMs: 60_000,
    });
    expect(snapshot.contextSummary.messageCount).toBeGreaterThan(0);
    expect(snapshot.contextSummary.recentItems.length).toBeGreaterThan(0);
    expect(summarize).toHaveBeenCalledOnce();
    expect(summarize.mock.calls[0]?.[0]).toMatchObject({
      systemPrompt: "story",
    });
    expect(metricService.record).toHaveBeenCalledWith({
      metricName: "agent.tool.call",
      value: 1,
      tags: {
        tool: "finish_story_batch",
        runtime: "storyAgent",
      },
    });
  });

  it("retries recoverable llm failures without exiting the story loop", async () => {
    initTestLoggerRuntime();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockRejectedValueOnce(
        new BizError({
          message: "LLM 上游服务调用失败",
        }),
      )
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-1",
              name: "finish_story_batch",
              arguments: {},
            },
          ],
        },
      } satisfies LlmChatResponsePayload);
    const runtime = new StoryLoopAgent({
      llmClient: {
        chat,
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn(),
      },
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 1,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "这个话题还没结束",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "这个话题还没结束",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 1,
      idleFlushMs: 60_000,
      llmRetryBackoffMs: 5_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      sleep,
    });

    const didProcess = await runtime.runOnce();

    expect(didProcess).toBe(true);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it("retries recoverable context summary failures during story compaction", async () => {
    initTestLoggerRuntime();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const summarize = vi
      .fn()
      .mockRejectedValueOnce(
        new BizError({
          message: "所选 LLM provider 当前不可用",
        }),
      )
      .mockResolvedValueOnce("累计 story 摘要");
    const context = new DefaultAgentContext({
      systemPrompt: "story",
    });
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient(
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "tool-call-1",
                name: "finish_story_batch",
                arguments: {},
              },
            ],
          },
        ],
        {
          totalTokens: 3,
        },
      ).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 1,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "story 消息",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "story 消息",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: summarize,
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 2,
      batchSize: 1,
      idleFlushMs: 60_000,
      llmRetryBackoffMs: 7_000,
      sourceRuntimeKey: "root-agent",
      context,
      sleep,
    });

    await runtime.runOnce();

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7_000);
    const snapshot = await context.getSnapshot();
    expect(snapshot.messages[0]).toMatchObject({
      role: "user",
    });
    expect(snapshot.messages[0]?.content).toContain("累计 story 摘要");
  });

  it("does not compact story context during initialize", async () => {
    const context = new DefaultAgentContext({
      systemPrompt: "story",
    });
    await context.appendMessages([createUserMessage("已有上下文")]);
    const summarize = vi.fn().mockResolvedValue("累计 story 摘要");
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient([]).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValue(0),
        findLatest: vi.fn().mockResolvedValue(null),
        listAfterSeq: vi.fn().mockResolvedValue([]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: summarize,
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 2,
      batchSize: 1,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context,
      sleep: vi.fn(),
    });

    await runtime.initialize();

    expect(summarize).not.toHaveBeenCalled();
  });

  it("skips story summary when totalTokens is missing", async () => {
    const summarize = vi.fn().mockResolvedValue("累计 story 摘要");
    const context = new DefaultAgentContext({
      systemPrompt: "story",
    });
    const runtime = new StoryLoopAgent({
      llmClient: createStubLlmClient([
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tool-call-1",
              name: "finish_story_batch",
              arguments: {},
            },
          ],
        },
      ]).client,
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        findLatest: vi.fn().mockResolvedValue({
          seq: 1,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "story 消息",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "story 消息",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: summarize,
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 2,
      batchSize: 1,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context,
      sleep: vi.fn(),
    });

    await runtime.runOnce();

    expect(summarize).not.toHaveBeenCalled();
  });

  it("still throws non-retryable llm failures", async () => {
    const error = new Error("boom");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runtime = new StoryLoopAgent({
      llmClient: {
        chat: vi.fn().mockRejectedValue(error),
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn(),
      },
      linearMessageLedgerDao: {
        insertMany: vi.fn(),
        countAfterSeq: vi.fn().mockResolvedValueOnce(1),
        findLatest: vi.fn().mockResolvedValue({
          seq: 1,
          runtimeKey: "root-agent",
          message: {
            role: "user",
            content: "还在讨论",
          },
          createdAt: new Date(),
        }),
        listAfterSeq: vi.fn().mockResolvedValue([
          {
            seq: 1,
            runtimeKey: "root-agent",
            message: {
              role: "user",
              content: "还在讨论",
            },
            createdAt: new Date(),
          },
        ]),
      },
      snapshotRepository: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 1,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context: new DefaultAgentContext({
        systemPrompt: "story",
      }),
      sleep,
    });

    await expect(runtime.runOnce()).rejects.toBe(error);
    expect(sleep).not.toHaveBeenCalled();
  });
});

function createStubLlmClient(
  messages: Array<
    Extract<Awaited<ReturnType<LlmClient["chat"]>>["message"], { role: "assistant" }>
  >,
  options?: {
    totalTokens?: number;
  },
): {
  client: LlmClient;
  chat: ReturnType<typeof vi.fn>;
} {
  let index = 0;

  const chat = vi.fn(
    async (): Promise<LlmChatResponsePayload> => ({
      provider: "openai",
      model: "gpt-test",
      message:
        messages[index++] ??
        ({
          role: "assistant",
          content: "",
          toolCalls: [],
        } satisfies LlmChatResponsePayload["message"]),
      ...(options?.totalTokens === undefined
        ? {}
        : {
            usage: {
              totalTokens: options.totalTokens,
            },
          }),
    }),
  );

  return {
    client: {
      chat,
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn(),
    },
    chat,
  };
}
