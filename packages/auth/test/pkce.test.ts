import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPkcePair } from "../src/shared/pkce.js";
import { safeParseJson } from "../src/shared/safe-parse-json.js";

describe("createPkcePair — PKCE 对生成", () => {
  it("codeChallenge 是 codeVerifier 的 sha256 base64url（RFC 7636 S256）", () => {
    const pair = createPkcePair();
    const expected = createHash("sha256").update(pair.codeVerifier).digest("base64url");
    expect(pair.codeChallenge).toBe(expected);
  });

  it("verifier 为 base64url 字符集且长度符合 RFC 7636（43-128）", () => {
    const pair = createPkcePair();
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(pair.state).toMatch(/^[0-9a-f]{48}$/);
  });

  it("多次调用产物互不相同（随机性冒烟）", () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.state).not.toBe(second.state);
  });
});

describe("safeParseJson — 宽松 JSON 解析", () => {
  it("合法 JSON 解析成功", () => {
    expect(safeParseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("非 JSON（OAuth 端点的 HTML 错误页等）返回 null 而非抛错", () => {
    expect(safeParseJson("<html>502</html>")).toBeNull();
    expect(safeParseJson("")).toBeNull();
  });
});
