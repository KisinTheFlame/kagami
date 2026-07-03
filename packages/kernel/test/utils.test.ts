import { describe, expect, it } from "vitest";
import { assertNever } from "../src/utils/assert.js";
import { stripLoneSurrogates, truncateWithEllipsis } from "../src/utils/text.js";

describe("stripLoneSurrogates — 剥除落单代理项（事故：半个 emoji 打挂会话）", () => {
  it("完整代理对（emoji）成对保留", () => {
    expect(stripLoneSurrogates("你好😀world")).toBe("你好😀world");
  });

  it("孤立高代理被丢弃", () => {
    const loneHigh = "abc" + "\uD83D" + "def";
    expect(stripLoneSurrogates(loneHigh)).toBe("abcdef");
  });

  it("孤立低代理被丢弃", () => {
    const loneLow = "abc" + "\uDE00" + "def";
    expect(stripLoneSurrogates(loneLow)).toBe("abcdef");
  });

  it("被 .slice 劈开的 emoji（尾部半个高代理）被清理，产物是合法 JSON 字符串", () => {
    const split = "引用😀".slice(0, 3); // "引用" + 高代理半个
    const cleaned = stripLoneSurrogates(split);
    expect(cleaned).toBe("引用");
    expect(() => JSON.stringify(cleaned)).not.toThrow();
    expect(JSON.parse(JSON.stringify(cleaned))).toBe("引用");
  });
});

describe("truncateWithEllipsis — 按码点截断，绝不劈代理对", () => {
  it("不超限时原样返回，不加省略号", () => {
    expect(truncateWithEllipsis("hello", 10)).toBe("hello");
  });

  it("超限时截到码点数并追加省略号", () => {
    expect(truncateWithEllipsis("abcdef", 3)).toBe("abc…");
  });

  it("emoji 记 1 个码点，截断落在 emoji 边界而非中间", () => {
    const text = "😀😁😂🤣😃";
    const truncated = truncateWithEllipsis(text, 3);
    expect(truncated).toBe("😀😁😂…");
    // 产物不含落单代理：再过一遍 strip 应无变化
    expect(stripLoneSurrogates(truncated)).toBe(truncated);
  });

  it("自定义省略号生效", () => {
    expect(truncateWithEllipsis("abcdef", 2, "...")).toBe("ab...");
  });

  it("输入自带落单代理时先清理再计数", () => {
    const dirty = "ab" + "\uD83D" + "cd";
    expect(truncateWithEllipsis(dirty, 10)).toBe("abcd");
  });
});

describe("assertNever", () => {
  it("被调用即抛错并带上值", () => {
    expect(() => assertNever("boom" as never)).toThrow("Unexpected value: boom");
  });
});
