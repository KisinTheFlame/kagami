import { describe, expect, it } from "vitest";
import { SpireReferenceSchema, SpireScreenSchema } from "@kagami/spire-api/contract";
import { newRun, applyAction } from "@kisinwen/sts-engine/engine/engine";
import { GreedyPolicy } from "@kisinwen/sts-engine/sim/policy";
import { toScreenView } from "../src/application/state-view.js";
import { lookupReference } from "../src/application/reference.js";

// === ScreenView 运行时契约符合性 ===
//
// registerJsonRoute 会对每个响应跑 `contract.output.parse`（issue #230/#274）：schema 与引擎
// 实际产出一旦漂移（如未来某个数值改动产生浮点、或新增 screen 枚举值），响应会在服务端 500、
// 且被 agent 侧归一成 SPIRE_NOT_READY 掩盖。这里用贪心策略跑整局，把每一步的 ScreenView 都
// 喂给 SpireScreenSchema.parse，钉死「引擎可达状态 ⊆ 契约 schema」。

const MAX_STEPS = 4000;

describe("ScreenView 运行时契约符合性", () => {
  it("整局对局的每一步 ScreenView 都通过 SpireScreenSchema.parse", () => {
    const state = newRun({ runId: "contract", seed: 20260703 });
    state.version = 1;
    const policy = new GreedyPolicy();
    let steps = 0;

    SpireScreenSchema.parse(toScreenView(state, {}));
    while (state.screen !== "victory" && state.screen !== "gameover" && steps < MAX_STEPS) {
      const action = policy.decide(state);
      const result = applyAction(state, action);
      if (result.ok) {
        state.version += 1;
      }
      SpireScreenSchema.parse(toScreenView(state, {}));
      SpireScreenSchema.parse(toScreenView(state, { suppressLog: true }));
      steps += 1;
    }
    // 走完一整局（而非 MAX_STEPS 截断），保证覆盖 gameover/victory 终局屏。
    expect(steps).toBeLessThan(MAX_STEPS);
  });

  it("参考查询全量语料通过 SpireReferenceSchema.parse", () => {
    SpireReferenceSchema.parse(lookupReference(""));
    SpireReferenceSchema.parse(lookupReference("打击"));
    SpireReferenceSchema.parse(lookupReference("不存在的东西xyz"));
  });
});
