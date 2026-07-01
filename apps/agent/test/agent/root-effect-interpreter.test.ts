import { describe, expect, it, vi } from "vitest";
import { createRootEffectInterpreter } from "../../src/agent/runtime/effect/root-effect-interpreter.js";
import type { SwitchAppEffect } from "../../src/agent/runtime/effect/root-agent-effect.js";
import type { AgentContext } from "../../src/agent/runtime/context/agent-context.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";

describe("root effect interpreter — switch_app", () => {
  it("sets current app and marks it entered when applying a switch_app effect", async () => {
    const setCurrentApp = vi.fn();
    const markAppEntered = vi.fn();
    const interpreter = createRootEffectInterpreter({
      session: { setCurrentApp, markAppEntered },
      // switch_app 只经 SwitchAppHandler，不碰 context / eventQueue，故给最小假实现即可。
      context: {} as AgentContext,
      eventQueue: { enqueue: vi.fn(), waitNonEmpty: vi.fn() } as unknown as Pick<
        AgentEventQueue,
        "enqueue" | "waitNonEmpty"
      >,
    });

    const switchEffect: SwitchAppEffect = { type: "switch_app", appId: "hn" };
    await interpreter.apply([switchEffect]);

    expect(setCurrentApp).toHaveBeenCalledWith("hn");
    expect(markAppEntered).toHaveBeenCalledWith("hn");
  });
});
