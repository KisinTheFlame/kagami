import { describe, expect, it, vi } from "vitest";
import { ToolCatalog } from "@kagami/agent-runtime";
import {
  FINALIZE_WEB_SEARCH_TOOL_NAME,
  FinalizeWebSearchTool,
} from "../../src/agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.js";
import {
  SEARCH_WEB_RAW_TOOL_NAME,
  SearchWebRawTool,
} from "../../src/agent/capabilities/web-search/task-agent/tools/search-web-raw.tool.js";
import { createWebSearchSubtoolOwner } from "../../src/agent/capabilities/web-search/task-agent/web-search-subtool-owner.js";
import { WebSearchTaskAgent as WebSearchAgent } from "../../src/agent/capabilities/web-search/task-agent/web-search-task-agent.js";
import { createWebSearchInstructionMessage } from "../../src/agent/runtime/context/context-message-factory.js";
import {
  InvokeTool,
  INVOKE_TOOL_NAME,
} from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload } from "../../src/llm/types.js";

/**
 * 构造一个聚焦于 WebSearchTaskAgent invoke 调度 + 终止判定的最小测试装配。
 *
 * 真实工厂里 taskTools 是 8 个顶层工具（7 个 OutOfScopeTool wrapper + 1 个
 * webSearchInvokeTool），这里只放 invokeTool 一个就够了——本测试只关心 invoke
 * 这一支的语义，OutOfScope wrapper 是另一类测试的话题。
 */
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
  const invokeTool = new InvokeTool({
    owners: [
      createWebSearchSubtoolOwner({
        tools: [new SearchWebRawTool({ webSearchService }), new FinalizeWebSearchTool()],
      }),
    ],
  });
  const toolCatalog = new ToolCatalog([invokeTool]);

  return {
    agent: new WebSearchAgent({
      llmClient,
      taskTools: toolCatalog.pick([INVOKE_TOOL_NAME]),
    }),
    chat,
    webSearchService,
  };
}

function makeInvokeToolCall(input: {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: input.id,
          name: INVOKE_TOOL_NAME,
          arguments: { tool: input.tool, ...input.args },
        },
      ],
    },
  };
}

describe("WebSearchAgent", () => {
  it("should search once and return the final summary", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "raw-1",
          tool: SEARCH_WEB_RAW_TOOL_NAME,
          args: { query: "OpenAI 最新新闻", topic: "news", timeRange: "week" },
        }),
      )
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "final-1",
          tool: FINALIZE_WEB_SEARCH_TOOL_NAME,
          args: { summary: "OpenAI 近期有新动态，但具体细节仍需以原始报道为准。" },
        }),
      );
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
          createWebSearchInstructionMessage("OpenAI 最近有什么新动态？"),
        ],
        toolChoice: "required",
        tools: expect.arrayContaining([expect.objectContaining({ name: INVOKE_TOOL_NAME })]),
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
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "raw-1",
          tool: SEARCH_WEB_RAW_TOOL_NAME,
          args: { query: "苹果发布会 时间" },
        }),
      )
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "raw-2",
          tool: SEARCH_WEB_RAW_TOOL_NAME,
          args: { query: "苹果发布会 新产品" },
        }),
      )
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "final-1",
          tool: FINALIZE_WEB_SEARCH_TOOL_NAME,
          args: { summary: "苹果发布会时间与新品信息来自不同搜索结果，摘要已综合两次检索。" },
        }),
      );
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
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "raw-empty",
          tool: SEARCH_WEB_RAW_TOOL_NAME,
          args: { query: "冷门问题" },
        }),
      )
      .mockResolvedValueOnce(
        makeInvokeToolCall({
          id: "final-empty",
          tool: FINALIZE_WEB_SEARCH_TOOL_NAME,
          args: { summary: "目前公开搜索结果较少，暂时没有足够证据给出确定结论。" },
        }),
      );
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
