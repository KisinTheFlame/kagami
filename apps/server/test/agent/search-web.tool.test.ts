import { describe, expect, it, vi } from "vitest";
import { SearchWebTool } from "../../src/agent/capabilities/web-search/tools/search-web.tool.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";

describe("search_web tool", () => {
  it("should prefer runtime-provided transient messages when invoking web search agent", async () => {
    const webSearchAgent = {
      search: vi.fn().mockResolvedValue("这是给主 Agent 的摘要结果。"),
    };
    const tool = new SearchWebTool({ webSearchAgent });
    const agentContext = new DefaultAgentContext({
      systemPromptFactory: () => "main-system-prompt",
    });
    await agentContext.appendMessages([
      { role: "user" as const, content: "群里有人在问 OpenAI 最近动态" },
    ]);
    const toolContext = {
      agentContext,
      rootAgentSession: {
        getCurrentGroupId: () => "group-1",
      },
      systemPrompt: "runtime-system-prompt",
      messages: [{ role: "user" as const, content: "这份消息应该优先透传" }],
    };

    const result = await tool.execute(
      {
        question: "  OpenAI latest news  ",
      },
      toolContext,
    );

    expect(tool.name).toBe("search_web");
    expect(webSearchAgent.search).toHaveBeenCalledWith({
      question: "OpenAI latest news",
      systemPrompt: "runtime-system-prompt",
      contextMessages: [{ role: "user", content: "这份消息应该优先透传" }],
    });
    expect(result.signal).toBe("continue");
    expect(result.content).toBe("这是给主 Agent 的摘要结果。");
  });

  it("should reject empty question", async () => {
    const webSearchAgent = {
      search: vi.fn(),
    };
    const tool = new SearchWebTool({ webSearchAgent });

    const result = await tool.execute(
      {
        question: "   ",
      },
      {},
    );

    expect(webSearchAgent.search).not.toHaveBeenCalled();
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("should return context unavailable error when tool context is missing", async () => {
    const webSearchAgent = {
      search: vi.fn(),
    };
    const tool = new SearchWebTool({ webSearchAgent });

    const result = await tool.execute(
      {
        question: "OpenAI latest news",
      },
      {},
    );

    expect(webSearchAgent.search).not.toHaveBeenCalled();
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "SESSION_UNAVAILABLE",
    });
  });

  it("should reject web search in portal state", async () => {
    const webSearchAgent = {
      search: vi.fn(),
    };
    const tool = new SearchWebTool({ webSearchAgent });
    const agentContext = new DefaultAgentContext({
      systemPromptFactory: () => "main-system-prompt",
    });
    const toolContext = {
      agentContext,
      rootAgentSession: {
        getCurrentGroupId: () => undefined,
      },
    } as Parameters<typeof tool.execute>[1];

    const result = await tool.execute(
      {
        question: "OpenAI latest news",
      },
      toolContext,
    );

    expect(webSearchAgent.search).not.toHaveBeenCalled();
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "STATE_TRANSITION_NOT_ALLOWED",
    });
  });

  it("should fall back to the agent context snapshot when runtime messages are absent", async () => {
    const webSearchAgent = {
      search: vi.fn(async input => {
        await agentContext.appendMessages([{ role: "user", content: "fork 之后的新消息" }]);
        return JSON.stringify(input);
      }),
    };
    const tool = new SearchWebTool({ webSearchAgent });
    const agentContext = new DefaultAgentContext({
      systemPromptFactory: () => "main-system-prompt",
    });
    await agentContext.appendMessages([{ role: "user", content: "fork 前的消息" }]);
    const toolContext = {
      agentContext,
      rootAgentSession: {
        getCurrentGroupId: () => "group-1",
      },
      systemPrompt: undefined,
      messages: undefined,
    };

    const result = await tool.execute(
      {
        question: "OpenAI latest news",
      },
      toolContext,
    );

    expect(webSearchAgent.search).toHaveBeenCalledWith({
      question: "OpenAI latest news",
      systemPrompt: "main-system-prompt",
      contextMessages: [{ role: "user", content: "fork 前的消息" }],
    });
    expect(JSON.parse(result.content)).toMatchObject({
      question: "OpenAI latest news",
      systemPrompt: "main-system-prompt",
      contextMessages: [{ role: "user", content: "fork 前的消息" }],
    });
  });
});
