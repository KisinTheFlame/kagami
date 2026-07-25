import { describe, expect, it } from "vitest";
import { selectFrontDoor, selectUpstreamKey } from "../src/routing.js";

// 前门三分岔的边界回归（#578：静态托管移交 kagami-web 后，网关只剩 自答 / 分流 / 转 web 三条路）。
describe("selectFrontDoor", () => {
  it("/health 由网关自答，不转给 web", () => {
    // 探的是前门自身活性；转给 web 会让 web 挂了时网关也显示不健康，误导监控。
    expect(selectFrontDoor("/health")).toBe("health");
  });

  it("/api/ 打头的走后端分流", () => {
    expect(selectFrontDoor("/api/todo")).toBe("api");
    expect(selectFrontDoor("/api/metric/query")).toBe("api");
  });

  it("前端页面与静态资源全部转 web", () => {
    expect(selectFrontDoor("/")).toBe("web");
    expect(selectFrontDoor("/dashboard")).toBe("web");
    expect(selectFrontDoor("/assets/app-a1b2c3d4.js")).toBe("web");
  });

  it("裸 /api（无尾斜杠）不算 API，落 web——与既有前缀判定逐字一致", () => {
    // 既有实现用的是 startsWith("/api/")，这里锁死该边界：改成 "/api" 会把前端的 /api 路由吞掉。
    expect(selectFrontDoor("/api")).toBe("web");
  });

  it("/healthz 一类近似路径不被 /health 误吞", () => {
    expect(selectFrontDoor("/healthz")).toBe("web");
  });
});

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
