import { describe, expect, it, vi } from "vitest";
import { TavilyWebSearchService } from "../../src/service/tavily-web-search.impl.service.js";

describe("TavilyWebSearchService", () => {
  it("should map Tavily response into internal search result", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          query: "kagami project",
          answer: "Kagami is a TypeScript project.",
          response_time: 1.23,
          results: [
            {
              title: "Kagami Docs",
              url: "https://example.com/docs",
              content: "A".repeat(500),
              score: 0.88,
              published_date: "2026-03-08",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const service = new TavilyWebSearchService({
      apiKey: "tvly-test",
      fetchImpl,
    });

    const result = await service.search({
      query: "kagami project",
      topic: "general",
      searchDepth: "advanced",
      maxResults: 2,
      includeDomains: ["example.com"],
      excludeDomains: ["ignored.com"],
      timeRange: "month",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tvly-test",
        }),
      }),
    );

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      query: "kagami project",
      topic: "general",
      search_depth: "advanced",
      max_results: 2,
      include_domains: ["example.com"],
      exclude_domains: ["ignored.com"],
      time_range: "month",
      include_answer: "basic",
      include_raw_content: false,
    });

    expect(result).toMatchObject({
      query: "kagami project",
      answer: "Kagami is a TypeScript project.",
      responseTime: 1.23,
      results: [
        {
          title: "Kagami Docs",
          url: "https://example.com/docs",
          score: 0.88,
          publishedDate: "2026-03-08",
        },
      ],
    });
    expect(result.results[0]?.content.length).toBe(400);
  });

  it("should throw when Tavily returns non-2xx response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
      }),
    );

    const service = new TavilyWebSearchService({
      apiKey: "tvly-test",
      fetchImpl,
    });

    await expect(
      service.search({
        query: "kagami project",
      }),
    ).rejects.toThrow("Tavily 请求失败（429）");
  });
});
