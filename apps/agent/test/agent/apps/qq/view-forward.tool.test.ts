import { describe, expect, it, vi } from "vitest";
import { ViewForwardTool } from "../../../../src/agent/apps/qq/tools/view-forward.tool.js";
import type { QqApp } from "../../../../src/agent/apps/qq/qq.app.js";

function toolWithViewForward(viewForward: ReturnType<typeof vi.fn>) {
  const app = { viewForward } as unknown as QqApp;
  return new ViewForwardTool({ getApp: () => app });
}

describe("ViewForwardTool", () => {
  it("strips the fwd- prefix before calling viewForward", async () => {
    const viewForward = vi
      .fn()
      .mockResolvedValue({ ok: true, content: "<qq_forward>x</qq_forward>" });
    const tool = toolWithViewForward(viewForward);

    const result = await tool.execute({ forward_id: "fwd-7655790222306405394" }, {});

    expect(viewForward).toHaveBeenCalledWith("7655790222306405394", 0);
    expect(result.content).toContain("<qq_forward>");
  });

  it("accepts a bare id string without prefix and passes the offset", async () => {
    const viewForward = vi.fn().mockResolvedValue({ ok: true, content: "x" });
    const tool = toolWithViewForward(viewForward);

    await tool.execute({ forward_id: "7655790222306405394", offset: 50 }, {});

    expect(viewForward).toHaveBeenCalledWith("7655790222306405394", 50);
  });

  it("rejects a numeric forward_id with guidance and never calls viewForward", async () => {
    const viewForward = vi.fn();
    const tool = toolWithViewForward(viewForward);

    // 超长 id 当数字传已丢精度——工具应拦下并提示改用字符串，而不是拿错 id 去查。
    // 用 Number(...) 运行时构造，避免源码里写超精度数字字面量（也正是这个 bug 的形态）。
    const result = await tool.execute({ forward_id: Number("7655790222306405394") }, {});

    expect(viewForward).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("FORWARD_ID_MUST_BE_STRING");
  });
});
