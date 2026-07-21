import { describe, expect, it, vi } from "vitest";
import type { BrowserClient } from "../../src/acl/browser-client.js";
import { BrowserError } from "../../src/agent/capabilities/browser/domain/errors.js";
import { BrowserNavigateTool } from "../../src/agent/capabilities/browser/tools/navigate.tool.js";
import { BrowserObserveTool } from "../../src/agent/capabilities/browser/tools/observe.tool.js";
import { BrowserClickTool } from "../../src/agent/capabilities/browser/tools/click.tool.js";
import { BrowserTypeTool } from "../../src/agent/capabilities/browser/tools/type.tool.js";
import { BrowserPressTool } from "../../src/agent/capabilities/browser/tools/press.tool.js";
import { BrowserWaitForTool } from "../../src/agent/capabilities/browser/tools/wait-for.tool.js";
import { BrowserEvalTool } from "../../src/agent/capabilities/browser/tools/eval.tool.js";

/**
 * KV 字节契约守卫：拆进程后工具仍在本地格式化结果，tool_result 字节必须与拆分前逐字不变。
 * 这些断言锁死每个工具的成功/失败输出字符串——任何漂移都会让在飞会话前缀失效（issue #173）。
 */

function fakeClient(overrides: Partial<BrowserClient>): BrowserClient {
  return overrides as unknown as BrowserClient;
}

const ctx = {} as never;

describe("browser tools golden（tool_result 字节）", () => {
  it("navigate", async () => {
    const tool = new BrowserNavigateTool({
      getBrowserClient: () =>
        fakeClient({ navigate: vi.fn().mockResolvedValue({ url: "https://e.com/", title: "E" }) }),
    });
    const result = await tool.execute({ url: "https://e.com" }, ctx);
    expect(result.content).toBe('{"ok":true,"url":"https://e.com/","title":"E"}');
  });

  it("observe", async () => {
    const tool = new BrowserObserveTool({
      getBrowserClient: () =>
        fakeClient({
          observe: vi
            .fn()
            .mockResolvedValue({ epoch: 7, url: "https://e.com", title: "E", snapshot: "SNAP" }),
        }),
    });
    const result = await tool.execute({}, ctx);
    expect(result.content).toBe(
      [
        '<browser_screen epoch="7" url="https://e.com" title="E">',
        "SNAP",
        "</browser_screen>",
        "提示：用 ref（形如 7:e3）调 browser_click / browser_type；ref 仅 epoch 7 有效，过期需重新 observe。",
      ].join("\n"),
    );
  });

  it("click", async () => {
    const tool = new BrowserClickTool({
      getBrowserClient: () =>
        fakeClient({ click: vi.fn().mockResolvedValue({ url: "https://e.com" }) }),
    });
    const result = await tool.execute({ target: "7:e3" }, ctx);
    expect(result.content).toBe('{"ok":true,"url":"https://e.com"}');
  });

  it("type", async () => {
    const tool = new BrowserTypeTool({
      getBrowserClient: () => fakeClient({ type: vi.fn().mockResolvedValue({ url: "u" }) }),
    });
    const result = await tool.execute({ ref: "7:e3", text: "hi" }, ctx);
    expect(result.content).toBe('{"ok":true,"url":"u"}');
  });

  it("press", async () => {
    const tool = new BrowserPressTool({
      getBrowserClient: () => fakeClient({ press: vi.fn().mockResolvedValue(undefined) }),
    });
    const result = await tool.execute({ key: "Enter" }, ctx);
    expect(result.content).toBe('{"ok":true}');
  });

  it("wait_for", async () => {
    const tool = new BrowserWaitForTool({
      getBrowserClient: () => fakeClient({ waitFor: vi.fn().mockResolvedValue(undefined) }),
    });
    const result = await tool.execute({ ms: 100 }, ctx);
    expect(result.content).toBe('{"ok":true}');
  });

  it("eval", async () => {
    const tool = new BrowserEvalTool({
      getBrowserClient: () => fakeClient({ evaluate: vi.fn().mockResolvedValue("2") }),
    });
    const result = await tool.execute({ script: "1+1" }, ctx);
    expect(result.content).toBe('{"ok":true,"result":"2"}');
  });

  it("失败路径：client 抛 BrowserError → 经 serializeBrowserError 出冻结结构字节", async () => {
    const tool = new BrowserNavigateTool({
      getBrowserClient: () =>
        fakeClient({
          navigate: vi
            .fn()
            .mockRejectedValue(
              new BrowserError("NAVIGATION_FAILED", "导航失败：boom", { url: "u" }),
            ),
        }),
    });
    const result = await tool.execute({ url: "https://e.com" }, ctx);
    expect(result.content).toBe(
      '{"ok":false,"error":"NAVIGATION_FAILED","message":"导航失败：boom","context":{"url":"u"}}',
    );
  });
});
