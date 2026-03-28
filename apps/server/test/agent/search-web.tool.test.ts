import { describe, expect, it, vi } from "vitest";
import { SearchWebTool } from "../../src/agent/tools/index.js";

describe("search_web tool", () => {
  it("should fork current context into injected web search agent and return summary text", async () => {
    const webSearchAgent = {
      search: vi.fn().mockResolvedValue("这是给主 Agent 的摘要结果。"),
    };
    const tool = new SearchWebTool({ webSearchAgent });
    const contextMessages = [{ role: "user" as const, content: "群里有人在问 OpenAI 最近动态" }];

    const result = await tool.execute(
      {
        question: "  OpenAI latest news  ",
      },
      {
        systemPrompt: "main-system-prompt",
        messages: contextMessages,
      },
    );

    expect(tool.name).toBe("search_web");
    expect(webSearchAgent.search).toHaveBeenCalledWith({
      question: "OpenAI latest news",
      systemPrompt: "main-system-prompt",
      contextMessages,
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
      error: "CONTEXT_UNAVAILABLE",
    });
  });
});
