import { describe, expect, it, vi } from "vitest";
import { StoryLoopAgent } from "../../src/agent/capabilities/story/runtime/story-agent.runtime.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { createUserMessage } from "../../src/agent/runtime/context/context-message-factory.js";
import { BizError } from "../../src/common/errors/biz-error.js";
import type { StoryRecallService } from "../../src/agent/capabilities/story/application/story-recall.service.js";
import type { StoryService } from "../../src/agent/capabilities/story/application/story.service.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload, LlmMessage } from "../../src/llm/types.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

describe("StoryLoopAgent", () => {
  it("processes a batch when pending messages reach the batch threshold", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "story-1",
      payload: {
        title: "权限交接吐槽",
        time: "今天",
        scene: "群聊",
        people: ["Alice"],
        cause: "继续吐槽流程",
        process: ["提到 CEO 审批"],
        result: "觉得流程离谱",
        status: "仍在延续",
      },
      sourceMessageSeqStart: 11,
      sourceMessageSeqEnd: 12,
      createdAt: new Date(),
      updatedAt: new Date(),
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
                title: "权限交接吐槽",
                time: "今天",
                scene: "群聊",
                people: ["Alice"],
                cause: "继续吐槽流程",
                process: ["提到 CEO 审批"],
                result: "觉得流程离谱",
                status: "仍在延续",
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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

  it("rewrites an existing story when a candidate story is recalled", async () => {
    const rewrite = vi.fn().mockResolvedValue({
      id: "story-1",
      payload: {
        title: "权限交接吐槽",
        time: "今天",
        scene: "群聊",
        people: ["Alice"],
        cause: "继续吐槽流程",
        process: ["提到 CEO 审批"],
        result: "觉得流程离谱",
        status: "仍在延续",
      },
      sourceMessageSeqStart: 1,
      sourceMessageSeqEnd: 21,
      createdAt: new Date(),
      updatedAt: new Date(),
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
                title: "权限交接吐槽",
                time: "今天",
                scene: "群聊",
                people: ["Alice"],
                cause: "继续吐槽流程",
                process: ["提到 CEO 审批"],
                result: "觉得流程离谱",
                status: "仍在延续",
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([
          {
            score: 0.9,
            matchedKinds: ["overview"],
            story: {
              id: "story-1",
              payload: {
                title: "旧 story",
                time: "",
                scene: "",
                people: [],
                cause: "",
                process: [],
                result: "",
                status: "",
              },
              sourceMessageSeqStart: 1,
              sourceMessageSeqEnd: 10,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ]),
      } as unknown as StoryRecallService,
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1]).toMatchObject({
      role: "user",
    });
    expect(typeof userMessages[1]?.content).toBe("string");
    expect(userMessages[1]?.content).toContain("[1] user");
    expect(userMessages[1]?.content).toContain("又在吐槽权限交接");
    expect(userMessages[1]?.content).toContain("[2] assistant");
    expect(userMessages[1]?.content).toContain("工具调用：search_memory");
    expect(userMessages[1]?.content).toContain("[3] tool");
    expect(userMessages[1]?.content).toContain("找到了一条旧记忆");
  });

  it("persists only the latest half of story context and avoids leading tool messages", async () => {
    const context = new DefaultAgentContext({
      systemPrompt: "story",
    });
    await context.appendMessages([
      {
        role: "user",
        content: "旧消息 1",
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            name: "search_memory",
            arguments: {
              query: "旧消息",
            },
          },
          {
            id: "tool-call-2",
            name: "search_memory",
            arguments: {
              query: "更多旧消息",
            },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "tool-call-1",
        content: "命中结果 1",
      },
      {
        role: "tool",
        toolCallId: "tool-call-2",
        content: "命中结果 2",
      },
      {
        role: "user",
        content: "较新的消息",
      },
      {
        role: "assistant",
        content: "较新的总结",
        toolCalls: [],
      },
    ]);
    const save = vi.fn().mockResolvedValue(undefined);
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
        save,
        delete: vi.fn().mockResolvedValue(undefined),
      },
      storyService: {
        create: vi.fn(),
        rewrite: vi.fn(),
      } as unknown as StoryService,
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
      contextSummaryOperation: {
        execute: vi.fn().mockResolvedValue(null),
      },
      summaryTools: [],
      contextCompactionTotalTokenThreshold: 100,
      batchSize: 1,
      idleFlushMs: 60_000,
      sourceRuntimeKey: "root-agent",
      context,
      sleep: vi.fn(),
    });

    await runtime.initialize();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]?.contextSnapshot.messages).toEqual([
      {
        role: "user",
        content: "较新的消息",
      },
      {
        role: "assistant",
        content: "较新的总结",
        toolCalls: [],
      },
    ]);
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
      storyRecallService: {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as StoryRecallService,
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
