import { describe, expect, it, vi } from "vitest";
import { createSearchWebTool } from "../../src/agent/tools/search-web.js";

describe("search_web tool", () => {
  it("should call injected web search service and return simplified agent output", async () => {
    const searchWeb = vi.fn().mockResolvedValue({
      query: "OpenAI latest news",
      answer: "Found recent coverage.",
      responseTime: 0.42,
      results: [
        {
          title: "OpenAI News",
          url: "https://example.com/openai-news",
          content: "Recent news summary",
          score: 0.91,
        },
        {
          title: "Another Source",
          url: "https://news.example.com/openai",
          content: "Another summary",
          score: 0.8,
          publishedDate: "2026-03-08",
        },
        {
          title: "Third Source",
          url: "https://third.example.com/openai",
          content: "Third summary",
          score: 0.7,
        },
        {
          title: "Fourth Source",
          url: "https://fourth.example.com/openai",
          content: "Fourth summary",
          score: 0.6,
        },
      ],
    });
    const tool = createSearchWebTool({ searchWeb });

    const result = await tool.execute({
      query: "  OpenAI latest news  ",
      topic: "news",
      timeRange: "week",
    });

    expect(tool.tool.name).toBe("search_web");
    expect(searchWeb).toHaveBeenCalledWith({
      query: "OpenAI latest news",
      topic: "news",
      timeRange: "week",
    });
    expect(result.shouldFinishRound).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      query: "OpenAI latest news",
      answer: "Found recent coverage.",
      sources: expect.arrayContaining([
        {
          title: "OpenAI News",
          content: "Recent news summary",
        },
      ]),
    });
    expect(JSON.parse(result.content).sources).toHaveLength(3);
  });

  it("should reject empty query", async () => {
    const searchWeb = vi.fn();
    const tool = createSearchWebTool({ searchWeb });

    const result = await tool.execute({
      query: "   ",
    });

    expect(searchWeb).not.toHaveBeenCalled();
    expect(result.shouldFinishRound).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
