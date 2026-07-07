import { describe, expect, it } from "vitest";
import { createAgentSystemPrompt } from "../../src/agent/runtime/root-agent/system-prompt.js";

describe("createAgentSystemPrompt", () => {
  const apps = [
    { id: "calc", displayName: "计算器", description: "对两个数做一次加减乘除，可设小数精度。" },
    { id: "browser", displayName: "浏览器", description: "完整操作网页，导航、点按、填表、截图。" },
    { id: "qq", displayName: "QQ", description: "收发 QQ 群聊与私聊消息，发图、传文件。" },
  ];

  it("embeds every registered app as `id：displayName——description` in the prompt", () => {
    const prompt = createAgentSystemPrompt({ creatorName: "测试创造者", apps });
    expect(prompt).toContain("你手机上现在装着这些 App");
    for (const app of apps) {
      expect(prompt).toContain(`- ${app.id}：${app.displayName}——${app.description}`);
    }
  });

  it("carries no volatile state (no current marker, no removed list_apps tool)", () => {
    const prompt = createAgentSystemPrompt({ creatorName: "测试创造者", apps });
    // 名单是稳定前缀，绝不带「当前在哪个 App」这类易变状态。
    expect(prompt).not.toContain("current");
    // list_apps 工具已移除，prompt 不应再引导去调它。
    expect(prompt).not.toContain("list_apps");
  });

  it("injects the creator name", () => {
    const prompt = createAgentSystemPrompt({ creatorName: "測試創造者XYZ", apps });
    expect(prompt).toContain("測試創造者XYZ");
  });

  it("omits the app-list section when there are no apps (degenerate fallback)", () => {
    const prompt = createAgentSystemPrompt({ creatorName: "unknown", apps: [] });
    expect(prompt).not.toContain("你手机上现在装着这些 App");
  });

  it("renders byte-identically for a fixed app set (KV 稳定前缀的关键不变量)", () => {
    // 主循环每轮都重新渲染 system prompt；只要 App 集合不变，输出必须逐字节相同，
    // 否则稳定前缀漂移、KV 缓存全量失效。这里锁死「相同入参 → 相同 prompt」。
    expect(createAgentSystemPrompt({ creatorName: "张三", apps })).toBe(
      createAgentSystemPrompt({ creatorName: "张三", apps }),
    );
  });
});
