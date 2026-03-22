import { describe, expect, it } from "vitest";
import { parseOutgoingMessageSegments } from "../../src/service/napcat-gateway/shared.js";

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
