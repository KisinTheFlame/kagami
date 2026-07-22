import { describe, expect, it } from "vitest";
import { selectUpstreamKey } from "../src/routing.js";

// 路由决策的边界回归：这层是「哪条请求打哪个进程」的唯一裁决点，前缀写错就会静默串进程。
describe("selectUpstreamKey", () => {
  it("provider 列举直连 llm（console-facing view，取代 agent 中转）", () => {
    expect(selectUpstreamKey("/llm/providers")).toBe("llm");
  });

  it("/llm-chat-call 仍落 console，不被 /llm/providers 前缀误吞", () => {
    // 关键边界：/llm-chat-call 既不等于 /llm/providers、也不以 /llm/providers/ 打头。
    expect(selectUpstreamKey("/llm-chat-call")).toBe("console");
    expect(selectUpstreamKey("/llm-chat-call/query")).toBe("console");
  });

  it("/auth 系列走 llm（OAuth 凭据中心）", () => {
    expect(selectUpstreamKey("/auth")).toBe("llm");
    expect(selectUpstreamKey("/auth/claude-code/status")).toBe("llm");
  });

  it("/metric 整段走 metric", () => {
    expect(selectUpstreamKey("/metric/points")).toBe("metric");
    expect(selectUpstreamKey("/metric/record")).toBe("metric");
  });

  it("/oss-object 走 oss、/scheduler/tasks 走 scheduler", () => {
    expect(selectUpstreamKey("/oss-object/42/content")).toBe("oss");
    expect(selectUpstreamKey("/scheduler/tasks")).toBe("scheduler");
    expect(selectUpstreamKey("/scheduler/tasks/todo/x/trigger")).toBe("scheduler");
  });

  it("/gba/roms 与 /gba/console 走 gba,游玩面 /gba/run 不放行(兜底 agent)", () => {
    expect(selectUpstreamKey("/gba/roms")).toBe("gba");
    expect(selectUpstreamKey("/gba/roms/delete")).toBe("gba");
    expect(selectUpstreamKey("/gba/console/screen")).toBe("gba");
    expect(selectUpstreamKey("/gba/console/state")).toBe("gba");
    // 游玩路由刻意不进分流表:浏览器经网关够不到按键/加载/前后台切换。
    expect(selectUpstreamKey("/gba/run/press")).toBe("agent");
    expect(selectUpstreamKey("/gba")).toBe("agent");
  });

  it("其余路径兜底到 agent", () => {
    expect(selectUpstreamKey("/main-agent-context/recent")).toBe("agent");
    expect(selectUpstreamKey("/")).toBe("agent");
  });
});
