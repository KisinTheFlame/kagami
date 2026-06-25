import { describe, expect, it } from "vitest";
import { BackTool } from "../../src/agent/runtime/root-agent/tools/back.tool.js";

describe("back tool", () => {
  // 手机 OS 模型下聊天状态树退役，桌面下没有可逐级 back 的子状态；back 恒返提示，
  // 退出 App 用 back_to_portal。
  it("always returns NO_PARENT_STATE pointing to back_to_portal", async () => {
    const tool = new BackTool();
    const result = await tool.execute({}, {} as Parameters<typeof tool.execute>[1]);

    expect(tool.name).toBe("back");
    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({ ok: false, error: "NO_PARENT_STATE" });
    expect(parsed.message).toContain("back_to_portal");
  });
});
