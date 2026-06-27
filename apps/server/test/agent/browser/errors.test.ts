import { describe, expect, it } from "vitest";
import {
  BrowserError,
  serializeBrowserError,
} from "../../../src/agent/capabilities/browser/domain/errors.js";

describe("serializeBrowserError", () => {
  it("序列化 BrowserError 为冻结结构 + 有序 context 字段", () => {
    const error = new BrowserError("STALE_REF", "ref 过期了", {
      ref: "2:e3",
      epoch: 2,
      currentEpoch: 5,
      url: "https://example.com",
    });

    const parsed = JSON.parse(serializeBrowserError(error)) as {
      ok: boolean;
      error: string;
      message: string;
      context: Record<string, unknown>;
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("STALE_REF");
    expect(parsed.message).toBe("ref 过期了");
    expect(parsed.context).toEqual({
      url: "https://example.com",
      ref: "2:e3",
      epoch: 2,
      currentEpoch: 5,
    });
    // context 字段顺序固定（url 先于 ref 先于 epoch），保证 KV 前缀稳定。
    expect(Object.keys(parsed.context)).toEqual(["url", "ref", "epoch", "currentEpoch"]);
  });

  it("把非 BrowserError 归一为 BROWSER_ERROR", () => {
    const parsed = JSON.parse(serializeBrowserError(new Error("随便一个错"))) as {
      ok: boolean;
      error: string;
      message: string;
      context: Record<string, unknown>;
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("BROWSER_ERROR");
    expect(parsed.message).toBe("随便一个错");
    expect(parsed.context).toEqual({});
  });

  it("空 context 时输出空对象（结构仍稳定）", () => {
    const parsed = JSON.parse(
      serializeBrowserError(new BrowserError("BROWSER_NOT_READY", "没就绪")),
    ) as { error: string; context: Record<string, unknown> };

    expect(parsed.error).toBe("BROWSER_NOT_READY");
    expect(parsed.context).toEqual({});
  });
});
