import { describe, expect, it } from "vitest";
import {
  buildOutgoingMessageSegments,
  formatImageSegmentText,
  parseOutgoingMessageSegments,
  renderSupportedMessageSegments,
} from "../../src/napcat/application/napcat-gateway/shared.js";

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

  it("should parse a single face segment by name", () => {
    expect(parseOutgoingMessageSegments("[表情: 比心]")).toEqual([
      {
        type: "face",
        data: {
          id: "319",
        },
      },
    ]);
  });

  it("should accept a face name without the space after colon", () => {
    expect(parseOutgoingMessageSegments("[表情:爱心]")).toEqual([
      {
        type: "face",
        data: {
          id: "66",
        },
      },
    ]);
  });

  it("should accept a full-width colon in the face marker", () => {
    expect(parseOutgoingMessageSegments("[表情：比心]")).toEqual([
      {
        type: "face",
        data: {
          id: "319",
        },
      },
    ]);
  });

  it("should keep a face segment inline with surrounding text", () => {
    expect(parseOutgoingMessageSegments("抱抱 [表情: 爱心] 哦")).toEqual([
      {
        type: "text",
        data: {
          text: "抱抱 ",
        },
      },
      {
        type: "face",
        data: {
          id: "66",
        },
      },
      {
        type: "text",
        data: {
          text: " 哦",
        },
      },
    ]);
  });

  it("should preserve order across mixed mention and face segments", () => {
    expect(parseOutgoingMessageSegments("{@甲(10001)} 赞一个 [表情: 赞]")).toEqual([
      {
        type: "at",
        data: {
          qq: "10001",
        },
      },
      {
        type: "text",
        data: {
          text: " 赞一个 ",
        },
      },
      {
        type: "face",
        data: {
          id: "76",
        },
      },
    ]);
  });

  it("should keep an unknown face name as plain text", () => {
    expect(parseOutgoingMessageSegments("[表情: 这不是表情]")).toEqual([
      {
        type: "text",
        data: {
          text: "[表情: 这不是表情]",
        },
      },
    ]);
  });

  it("should keep an unknown face as text while still parsing a known one", () => {
    expect(parseOutgoingMessageSegments("[表情: 这不是表情][表情: 比心]")).toEqual([
      {
        type: "text",
        data: {
          text: "[表情: 这不是表情]",
        },
      },
      {
        type: "face",
        data: {
          id: "319",
        },
      },
    ]);
  });
});

describe("buildOutgoingMessageSegments", () => {
  it("falls back to plain parsing when no reply target is given", () => {
    expect(buildOutgoingMessageSegments("hello group")).toEqual([
      {
        type: "text",
        data: {
          text: "hello group",
        },
      },
    ]);
  });

  it("prepends a reply segment when a reply target is given", () => {
    expect(buildOutgoingMessageSegments("好的", 9988)).toEqual([
      {
        type: "reply",
        data: {
          id: "9988",
        },
      },
      {
        type: "text",
        data: {
          text: "好的",
        },
      },
    ]);
  });

  it("keeps the reply segment before parsed mention segments", () => {
    expect(buildOutgoingMessageSegments("{@闻震(870853294)} 收到", 9988)).toEqual([
      {
        type: "reply",
        data: {
          id: "9988",
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
          text: " 收到",
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

  it("should render a face segment using faceText when present", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "face",
          data: {
            id: "319",
            raw: { faceIndex: 319, faceText: "/比心" },
            resultId: null,
            chainCount: null,
          },
        },
      ]),
    ).toBe("[表情: 比心]");
  });

  it("should render a face segment via the name map when faceText is absent", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "face",
          data: {
            id: "66",
            raw: { faceIndex: 66 },
            resultId: null,
            chainCount: null,
          },
        },
      ]),
    ).toBe("[表情: 爱心]");
  });

  it("should fall back to [表情] when the face is unknown", () => {
    expect(
      renderSupportedMessageSegments([
        {
          type: "face",
          data: {
            id: "99999",
            raw: {},
            resultId: null,
            chainCount: null,
          },
        },
      ]),
    ).toBe("[表情]");
  });

  it("should keep face segments inline with surrounding text", () => {
    expect(
      renderSupportedMessageSegments([
        { type: "text", data: { text: "前" } },
        {
          type: "face",
          data: {
            id: "66",
            raw: { faceIndex: 66 },
            resultId: null,
            chainCount: null,
          },
        },
        { type: "text", data: { text: "后" } },
      ]),
    ).toBe("前[表情: 爱心]后");
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
