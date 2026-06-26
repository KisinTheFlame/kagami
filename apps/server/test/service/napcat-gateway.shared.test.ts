import { describe, expect, it } from "vitest";
import {
  formatImageSegmentText,
  parseOutgoingMessageSegments,
  renderSupportedMessageSegments,
} from "../../src/napcat/service/napcat-gateway/shared.js";

describe("parseOutgoingMessageSegments", () => {
  it("should keep plain text as a single text segment", () => {
    expect(parseOutgoingMessageSegments("hello group")).toEqual([
      {
        type: "text",
        data: {
          text: "hello group",
        },
      },
    ]);
  });

  it("should parse a single mention segment", () => {
    expect(parseOutgoingMessageSegments("{@闻震(870853294)}")).toEqual([
      {
        type: "at",
        data: {
          qq: "870853294",
        },
      },
    ]);
  });

  it("should split text around a mention", () => {
    expect(parseOutgoingMessageSegments("你好 {@闻震(870853294)} hi")).toEqual([
      {
        type: "text",
        data: {
          text: "你好 ",
        },
      },
      {
        type: "at",
        data: {
          qq: "870853294",
        },
      },
      {
        type: "text",
        data: {
          text: " hi",
        },
      },
    ]);
  });

  it("should preserve order for multiple mentions", () => {
    expect(parseOutgoingMessageSegments("{@甲(10001)} hi {@乙(10002)}")).toEqual([
      {
        type: "at",
        data: {
          qq: "10001",
        },
      },
      {
        type: "text",
        data: {
          text: " hi ",
        },
      },
      {
        type: "at",
        data: {
          qq: "10002",
        },
      },
    ]);
  });

  it("should support mention all", () => {
    expect(parseOutgoingMessageSegments("{@全体成员(all)}")).toEqual([
      {
        type: "at",
        data: {
          qq: "all",
        },
      },
    ]);
  });

  it("should keep malformed mention syntax as plain text", () => {
    expect(parseOutgoingMessageSegments("{@闻震}")).toEqual([
      {
        type: "text",
        data: {
          text: "{@闻震}",
        },
      },
    ]);
    expect(parseOutgoingMessageSegments("{@闻震(abc)}")).toEqual([
      {
        type: "text",
        data: {
          text: "{@闻震(abc)}",
        },
      },
    ]);
  });
});

describe("renderSupportedMessageSegments", () => {
  it("should render a hydrated reply segment without a leading blank line", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "reply",
          data: {
            id: "9988",
            senderNickname: "小明",
            senderUserId: "10001",
            messagePreview: "你好",
          },
        },
      ]),
    ).toBe("<reference>\n回复 小明 (10001):\n你好\n</reference>\n");
  });

  it("should render an empty reply reference without a leading blank line", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "reply",
          data: {
            id: "9988",
          },
        },
      ]),
    ).toBe("<reference />\n");
  });

  it("should keep adjacent text and reply segments without inserting extra blank lines", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "text",
          data: {
            text: "前缀",
          },
        },
        {
          type: "reply",
          data: {
            id: "9988",
            senderNickname: "小明",
            senderUserId: "10001",
            messagePreview: "你好",
          },
        },
        {
          type: "text",
          data: {
            text: "后缀",
          },
        },
      ]),
    ).toBe("前缀<reference>\n回复 小明 (10001):\n你好\n</reference>\n后缀");
  });

  it("should render a forward segment as a [forward_id: ...] placeholder", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "forward",
          data: {
            id: "7655556533027578193",
          },
        },
      ]),
    ).toBe("[forward_id: fwd-7655556533027578193]");
  });

  it("should fall back to [合并转发] when a forward segment has no id", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "forward",
          data: {
            id: "",
          },
        },
      ]),
    ).toBe("[合并转发]");
  });

  it("should render an image segment with its OSS resid", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "image",
          data: {
            summary: "一只橘猫",
            file: "ABC.png",
            sub_type: 0,
            url: "https://example.com/cat.png",
            file_size: "100",
            resid: "res-42",
          },
        },
      ]),
    ).toBe("[图片: 一只橘猫, resid: res-42]");
  });
});

describe("formatImageSegmentText", () => {
  it("appends resid when present", () => {
    expect(formatImageSegmentText("一只猫", "res-42")).toBe("[图片: 一只猫, resid: res-42]");
  });

  it("omits the resid when absent", () => {
    expect(formatImageSegmentText("一只猫", null)).toBe("[图片: 一只猫]");
    expect(formatImageSegmentText("一只猫")).toBe("[图片: 一只猫]");
  });

  it("keeps the resid even when there is no description", () => {
    expect(formatImageSegmentText("", "res-7")).toBe("[图片, resid: res-7]");
  });

  it("falls back to [图片] when both description and resid are empty", () => {
    expect(formatImageSegmentText("", null)).toBe("[图片]");
  });
});
