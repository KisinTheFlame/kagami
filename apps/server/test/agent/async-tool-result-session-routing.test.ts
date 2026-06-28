import { describe, expect, it } from "vitest";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";

describe("RootAgentSession async_tool_result_completed 路由", () => {
  it("事件触发新一轮，flush 后尾部追加 <async_tool_result> 消息", async () => {
    const context = new DefaultAgentContext({ systemPromptFactory: () => "sp" });
    const session = new RootAgentSession({ context });

    const consumed = await session.consumeIncomingEvent({
      type: "async_tool_result_completed",
      data: {
        taskId: "t1",
        toolName: "search_web",
        outcome: { status: "success", content: "摘要" },
      },
    });
    expect(consumed).toEqual({ shouldTriggerRound: true });

    const flushed = await session.flushPendingIncomingEffects();
    expect(flushed.shouldTriggerRound).toBe(true);

    const snapshot = await context.getSnapshot();
    const last = snapshot.messages[snapshot.messages.length - 1];
    expect(last.role).toBe("user");
    expect(typeof last.content === "string" && last.content).toContain(
      '<async_tool_result task_id="t1" tool="search_web">',
    );
    expect(typeof last.content === "string" && last.content).toContain("摘要");
  });
});
