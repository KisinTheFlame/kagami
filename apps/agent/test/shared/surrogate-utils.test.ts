import { stripLoneSurrogates, truncateWithEllipsis } from "@kagami/kernel/utils/text";
import { describe, expect, it } from "vitest";

// 🎯 = U+1F3AF = "🎯"（高代理 U+D83C + 低代理 U+DFAF）
const HIGH = "\ud83c"; // 落单高代理（emoji 前半）
const LOW = "\udfaf"; // 落单低代理

// 校验字符串里是否还有落单代理项（真正会让上游 400 的东西）。
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("stripLoneSurrogates", () => {
  it("剥掉落单的高代理", () => {
    expect(stripLoneSurrogates(`哥布林👊${HIGH}`)).toBe("哥布林👊");
  });

  it("剥掉落单的低代理", () => {
    expect(stripLoneSurrogates(`abc${LOW}def`)).toBe("abcdef");
  });

  it("完整的 emoji 代理对原样保留", () => {
    expect(stripLoneSurrogates("干杯🎯🍺完毕")).toBe("干杯🎯🍺完毕");
  });

  it("普通文本不变", () => {
    expect(stripLoneSurrogates("哥布林 hello 123")).toBe("哥布林 hello 123");
  });

  it("末尾落单高代理（charCodeAt 越界返回 NaN）也剥掉", () => {
    const out = stripLoneSurrogates(`结尾${HIGH}`);
    expect(out).toBe("结尾");
    expect(hasLoneSurrogate(out)).toBe(false);
  });
});

describe("truncateWithEllipsis", () => {
  it("正好从 emoji 代理对中间截断 → 不留半个字符（事故根因）", () => {
    // 50 个普通字 + 一个 emoji：按 UTF-16 slice(0,50) 会把 emoji 劈成半个高代理。
    const text = "字".repeat(50) + "🎯尾巴";
    const out = truncateWithEllipsis(text, 50);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out).toBe("字".repeat(50) + "…");
  });

  it("emoji 恰好落在截断边界内 → 整颗保留、不切开", () => {
    const text = "ab🎯cd更多内容拉长到超过上限吧";
    const out = truncateWithEllipsis(text, 3);
    expect(out).toBe("ab🎯…");
    expect(hasLoneSurrogate(out)).toBe(false);
  });

  it("码点计数：一个 emoji 记 1 个（不是 2 个 UTF-16 码元）", () => {
    // 5 个 emoji = 5 码点，上限 5 → 不截断。
    expect(truncateWithEllipsis("🎯🍺👊🔥🌍", 5)).toBe("🎯🍺👊🔥🌍");
    // 上限 3 → 保留前 3 颗 + …
    expect(truncateWithEllipsis("🎯🍺👊🔥🌍", 3)).toBe("🎯🍺👊…");
  });

  it("短于上限的文本原样返回（但仍剥除已有的落单代理项）", () => {
    expect(truncateWithEllipsis("短文本", 50)).toBe("短文本");
    expect(truncateWithEllipsis(`脏${HIGH}数据`, 50)).toBe("脏数据");
  });

  it("自定义 ellipsis", () => {
    expect(truncateWithEllipsis("字".repeat(10), 3, "…（已截断）")).toBe("字字字…（已截断）");
  });
});
