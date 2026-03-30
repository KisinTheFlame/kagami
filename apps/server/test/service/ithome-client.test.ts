import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultIthomeClient } from "../../src/news/application/ithome-client.js";

describe("DefaultIthomeClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should parse rss items with many html entities", async () => {
    const encodedParagraph = Array.from({ length: 1200 }, () => "&lt;p&gt;段落&lt;/p&gt;").join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `
<rss version="2.0">
  <channel>
    <item>
      <title>测试新闻</title>
      <description>${encodedParagraph}</description>
      <link>https://www.ithome.com/0/1/001.htm</link>
      <guid>https://www.ithome.com/0/1/001.htm</guid>
      <pubDate>Mon, 30 Mar 2026 04:21:03 GMT</pubDate>
    </item>
  </channel>
</rss>
`,
      }),
    );

    const client = new DefaultIthomeClient();
    const items = await client.fetchFeedItems();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "测试新闻",
      url: "https://www.ithome.com/0/1/001.htm",
    });
  });
});
