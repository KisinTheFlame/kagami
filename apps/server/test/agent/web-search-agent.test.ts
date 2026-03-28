import { describe, expect, it, vi } from "vitest";
import {
  FINALIZE_WEB_SEARCH_TOOL_NAME,
  FinalizeWebSearchTool,
  SEARCH_WEB_RAW_TOOL_NAME,
  SearchWebRawTool,
  WebSearchAgent,
} from "../../src/agent/agents/subagents/web-search/index.js";
import { createWebSearchReminderMessage } from "../../src/agent/context/context-message-factory.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload } from "../../src/llm/types.js";
import { ToolCatalog } from "../../src/agent/tools/index.js";

function createWebSearchAgent(params?: {
  chat?: ReturnType<typeof vi.fn>;
  search?: ReturnType<typeof vi.fn>;
}) {
  const chat = params?.chat ?? vi.fn();
  const llmClient: LlmClient = {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  };
  const webSearchService = {
    search:
      params?.search ??
      vi.fn().mockResolvedValue({
        query: "OpenAI 最新消息",
        answer: "最新消息摘要",
        results: [
          {
            title: "News",
            url: "https://example.com/news",
            content: "新闻内容",
            publishedDate: "2026-03-26",
          },
        ],
      }),
  };
  const toolCatalog = new ToolCatalog([
    new SearchWebRawTool({
      webSearchService,
    }),
    new FinalizeWebSearchTool(),
  ]);

  return {
    agent: new WebSearchAgent({
      llmClient,
      searchTools: toolCatalog.pick([SEARCH_WEB_RAW_TOOL_NAME, FINALIZE_WEB_SEARCH_TOOL_NAME]),
    }),
    chat,
    webSearchService,
  };
}

describe("WebSearchAgent", () => {
  it("should search once and return the final summary", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "raw-1",
              name: SEARCH_WEB_RAW_TOOL_NAME,
              arguments: {
                query: "OpenAI 最新新闻",
                topic: "news",
                timeRange: "week",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "final-1",
              name: FINALIZE_WEB_SEARCH_TOOL_NAME,
              arguments: {
                summary: "OpenAI 近期有新动态，但具体细节仍需以原始报道为准。",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload);
    const { agent, webSearchService } = createWebSearchAgent({ chat });

    await expect(
      agent.search({
        question: "OpenAI 最近有什么新动态？",
        systemPrompt: "main-system-prompt",
        contextMessages: [{ role: "user", content: "群里有人问 OpenAI 最近怎么了" }],
      }),
    ).resolves.toBe("OpenAI 近期有新动态，但具体细节仍需以原始报道为准。");

    expect(webSearchService.search).toHaveBeenCalledWith({
      query: "OpenAI 最新新闻",
      topic: "news",
      timeRange: "week",
    });
    expect(chat).toHaveBeenNthCalledWith(
      1,
      {
        system: "main-system-prompt",
        messages: [
          {
            role: "user",
            content: "群里有人问 OpenAI 最近怎么了",
          },
          createWebSearchReminderMessage("OpenAI 最近有什么新动态？"),
        ],
        toolChoice: "required",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: SEARCH_WEB_RAW_TOOL_NAME }),
          expect.objectContaining({ name: FINALIZE_WEB_SEARCH_TOOL_NAME }),
        ]),
      },
      {
        usage: "webSearchAgent",
      },
    );
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("should support multiple searches before finalizing", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "raw-1",
              name: SEARCH_WEB_RAW_TOOL_NAME,
              arguments: {
                query: "苹果发布会 时间",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "raw-2",
              name: SEARCH_WEB_RAW_TOOL_NAME,
              arguments: {
                query: "苹果发布会 新产品",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "final-1",
              name: FINALIZE_WEB_SEARCH_TOOL_NAME,
              arguments: {
                summary: "苹果发布会时间与新品信息来自不同搜索结果，摘要已综合两次检索。",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload);
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        query: "苹果发布会 时间",
        results: [],
      })
      .mockResolvedValueOnce({
        query: "苹果发布会 新产品",
        results: [],
      });
    const { agent, webSearchService } = createWebSearchAgent({ chat, search });

    await expect(
      agent.search({
        question: "苹果这次发布会是什么时候，有哪些新品？",
        systemPrompt: "main-system-prompt",
        contextMessages: [{ role: "user", content: "群里在聊苹果发布会" }],
      }),
    ).resolves.toBe("苹果发布会时间与新品信息来自不同搜索结果，摘要已综合两次检索。");

    expect(webSearchService.search).toHaveBeenCalledTimes(2);
    expect(webSearchService.search).toHaveBeenNthCalledWith(1, {
      query: "苹果发布会 时间",
    });
    expect(webSearchService.search).toHaveBeenNthCalledWith(2, {
      query: "苹果发布会 新产品",
    });
  });

  it("should return uncertainty summary when results are sparse", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "raw-empty",
              name: SEARCH_WEB_RAW_TOOL_NAME,
              arguments: {
                query: "冷门问题",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-4o-mini",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "final-empty",
              name: FINALIZE_WEB_SEARCH_TOOL_NAME,
              arguments: {
                summary: "目前公开搜索结果较少，暂时没有足够证据给出确定结论。",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload);
    const search = vi.fn().mockResolvedValue({
      query: "冷门问题",
      answer: undefined,
      results: [],
    });
    const { agent } = createWebSearchAgent({ chat, search });

    await expect(
      agent.search({
        question: "这个冷门问题有确定答案吗？",
        systemPrompt: "main-system-prompt",
        contextMessages: [{ role: "user", content: "刚才有人提了一个冷门问题" }],
      }),
    ).resolves.toBe("目前公开搜索结果较少，暂时没有足够证据给出确定结论。");
  });

  it("should require system prompt and context messages from the main agent", async () => {
    const { agent } = createWebSearchAgent();

    await expect(
      agent.search({
        question: "OpenAI 最近有什么新动态？",
        systemPrompt: "   ",
        contextMessages: [],
      }),
    ).rejects.toThrow("WebSearchAgent.search requires a non-empty systemPrompt");
  });
});
