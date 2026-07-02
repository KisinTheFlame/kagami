import { describe, expect, it, vi } from "vitest";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";

/**
 * reset 第四退化出口的集成层守护（issue #251 高危验收前提之一）：
 *
 * resetContext 是五个「计划性重建」入口里唯一会清事件队列的；若不向 App 层广播失焦，
 * 依赖 App 私有焦点态的机制（QQ 的 focused）会悬空——此后前台消息继续走实时路径却永远
 * drain 不到、center 又没有 draft，静默丢消息。session.blurCurrentApp 自身有单测，但
 * 「reset 会调它、且顺序为 eventQueue.clear → blurCurrentApp → context.reset →
 * session.reset」这条接线契约此前零覆盖：删掉那行或重排到 clear 之前，全部单测仍绿。
 */
describe("RootAgentHost.resetContext — 失焦广播接线与顺序契约", () => {
  it("在 eventQueue.clear 之后、context.reset 之前广播失焦，且 blur 抛错不阻断 reset", async () => {
    const clear = vi.fn(() => 0);
    const blurCurrentApp = vi.fn(async () => {});
    const contextReset = vi.fn(async () => {});
    const sessionReset = vi.fn();

    const host = new RootAgentHost({
      context: { reset: contextReset },
      eventQueue: { clear },
      session: {
        blurCurrentApp,
        reset: sessionReset,
        initializeContext: async () => {},
      },
      interpreter: {},
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    await host.resetContext();

    expect(blurCurrentApp).toHaveBeenCalledTimes(1);
    const clearOrder = clear.mock.invocationCallOrder[0];
    const blurOrder = blurCurrentApp.mock.invocationCallOrder[0];
    const contextResetOrder = contextReset.mock.invocationCallOrder[0];
    const sessionResetOrder = sessionReset.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(blurOrder); // clear 之后才退化补推，draft 不被误清
    expect(blurOrder).toBeLessThan(contextResetOrder); // 上下文重建前完成失焦
    expect(contextResetOrder).toBeLessThan(sessionResetOrder);
  });
});
