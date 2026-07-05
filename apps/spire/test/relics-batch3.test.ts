import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { Effect, GameState, RelicState } from "../src/engine/types.js";

// PR（遗物批次 2）：借既有钩子（计数 / 回合始 / 失血 / 战斗始）的通用遗物。

function run(): GameState {
  return newRun({ runId: "rb3", seed: 6, character: "ironclad" });
}

/** 反复调用一个 emit 型钩子，收集其发射的 Effect。 */
function collectHook(times: number, invoke: (self: RelicState, emit: (e: Effect) => void) => void) {
  const self: RelicState = { id: "x", counter: 0 };
  const emitted: Effect[] = [];
  for (let i = 0; i < times; i += 1) {
    invoke(self, e => emitted.push(e));
  }
  return emitted;
}

describe("战争艺术：不出攻击则下回合 +1 能量", () => {
  it("战斗第一回合即 +1 能量", () => {
    const s = run();
    grantRelic(s, "art_of_war");
    startCombat(s, "cultist");
    expect(s.combat!.energy).toBe(s.combat!.maxEnergy + 1);
  });
});

describe("墨水瓶：每 10 张牌抽 1", () => {
  it("第 10 次出牌触发抽 1", () => {
    const hooks = getRelicDef("ink_bottle").hooks;
    const emitted = collectHook(10, (self, emit) =>
      hooks.onCardPlayed!(run(), self, "skill", emit),
    );
    expect(emitted).toEqual([{ kind: "draw", amount: 1 }]);
  });
});

describe("熏香炉：每 6 回合 +1 虚无缥缈", () => {
  it("第 6 次回合始触发", () => {
    const hooks = getRelicDef("incense_burner").hooks;
    const emitted = collectHook(6, (self, emit) => hooks.onTurnStart!(run(), self, emit));
    expect(emitted).toEqual([{ kind: "apply_power", power: "intangible", amount: 1, on: "self" }]);
  });
});

describe("自塑黏土：失血 → 下回合 +3 格挡", () => {
  it("每次失血 emit 一次下回合格挡", () => {
    const hooks = getRelicDef("self_forming_clay").hooks;
    const emitted = collectHook(1, (self, emit) => hooks.onLoseHp!(run(), self, emit));
    expect(emitted).toEqual([{ kind: "gain_block_next_turn", amount: 3 }]);
  });
});

describe("杜巫娃娃：每张诅咒 +1 力量（战斗开始）", () => {
  it("牌组 2 张诅咒 → 战斗开始 +2 力量", () => {
    const s = run();
    grantRelic(s, "du_vu_doll");
    s.deck.push(
      { uid: s.nextUid++, defId: "injury", upgraded: false },
      { uid: s.nextUid++, defId: "regret", upgraded: false },
    );
    startCombat(s, "cultist");
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
  });
});
