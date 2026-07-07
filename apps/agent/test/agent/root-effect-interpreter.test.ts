import { describe, expect, it, vi } from "vitest";
import { createRootEffectInterpreter } from "../../src/agent/runtime/effect/root-effect-interpreter.js";
import type {
  SwitchAppEffect,
  WaitForEventEffect,
} from "../../src/agent/runtime/effect/root-agent-effect.js";
import type { AgentContext } from "../../src/agent/runtime/context/agent-context.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";

describe("root effect interpreter — switch_app", () => {
  it("sets current app and marks it entered when applying a switch_app effect", async () => {
    const setCurrentApp = vi.fn();
    const markAppEntered = vi.fn();
    const setSuspended = vi.fn();
    const interpreter = createRootEffectInterpreter({
      session: { setCurrentApp, markAppEntered, setSuspended },
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

describe("root effect interpreter — wait_for_event 挂起置位", () => {
  it("在 waitNonEmpty 前置 suspended=true、返回后清位 false（成对，供状态采样归 wait 桶）", async () => {
    const setSuspended = vi.fn();
    const calls: string[] = [];
    // waitNonEmpty resolve 前记录一次 suspended 状态：验证 await 期间处于挂起。
    const waitNonEmpty = vi.fn(async () => {
      calls.push(`await:${setSuspended.mock.calls.at(-1)?.[0]}`);
    });
    const interpreter = createRootEffectInterpreter({
      session: { setCurrentApp: vi.fn(), markAppEntered: vi.fn(), setSuspended },
      context: {} as AgentContext,
      eventQueue: { enqueue: vi.fn(), waitNonEmpty } as unknown as Pick<
        AgentEventQueue,
        "enqueue" | "waitNonEmpty"
      >,
    });

    const waitEffect: WaitForEventEffect = { type: "wait_for_event", maxWaitMs: 1000 };
    await interpreter.apply([waitEffect]);

    expect(calls).toEqual(["await:true"]); // await 期间确实挂起
    expect(setSuspended.mock.calls).toEqual([[true], [false]]); // 成对置位/清位
  });

  it("waitNonEmpty 抛错时仍在 finally 清位 suspended=false", async () => {
    const setSuspended = vi.fn();
    const waitNonEmpty = vi.fn(async () => {
      throw new Error("boom");
    });
    const interpreter = createRootEffectInterpreter({
      session: { setCurrentApp: vi.fn(), markAppEntered: vi.fn(), setSuspended },
      context: {} as AgentContext,
      eventQueue: { enqueue: vi.fn(), waitNonEmpty } as unknown as Pick<
        AgentEventQueue,
        "enqueue" | "waitNonEmpty"
      >,
    });

    const waitEffect: WaitForEventEffect = { type: "wait_for_event", maxWaitMs: 1000 };
    await expect(interpreter.apply([waitEffect])).rejects.toThrow("boom");
    expect(setSuspended.mock.calls).toEqual([[true], [false]]);
  });
});
