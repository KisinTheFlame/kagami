import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import type { Effect, GameState, RelicState } from "../src/engine/types.js";

// PR（计数/能量触发型遗物）。

function combatWith(relic: string): GameState {
  const s = newRun({ runId: "rb5", seed: 2, character: "ironclad" });
  grantRelic(s, relic);
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("冰淇淋：能量跨回合保留", () => {
  it("上回合剩 2 能量 → 下回合 2 + 上限", () => {
    const s = combatWith("ice_cream");
    s.combat!.energy = 2; // 模拟本回合剩余
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.energy).toBe(2 + s.combat!.maxEnergy);
  });
});

describe("怀表：出牌 ≤3 则下回合抽 3", () => {
  it("回合末≤3张 → 预约；回合始抽 3", () => {
    const hooks = getRelicDef("pocketwatch").hooks;
    const self: RelicState = { id: "pocketwatch", counter: 0 };
    const s = newRun({ runId: "pw", seed: 1 });
    startCombat(s, "cultist");
    s.combat!.cardsPlayedThisTurn = 2;
    hooks.onTurnEnd?.(s, self, () => {});
    expect(self.counter).toBe(1);
    const emitted: Effect[] = [];
    hooks.onTurnStart?.(s, self, e => emitted.push(e));
    expect(emitted).toEqual([{ kind: "draw", amount: 3 }]);
    expect(self.counter).toBe(0);
  });

  it("出牌 4 张则不预约", () => {
    const hooks = getRelicDef("pocketwatch").hooks;
    const self: RelicState = { id: "pocketwatch", counter: 0 };
    const s = newRun({ runId: "pw2", seed: 1 });
    startCombat(s, "cultist");
    s.combat!.cardsPlayedThisTurn = 4;
    hooks.onTurnEnd?.(s, self, () => {});
    expect(self.counter).toBe(0);
  });
});

describe("木乃伊手：打出能力牌 → 随机手牌 0 费", () => {
  it("能力牌触发 make_random_hand_card_free", () => {
    const hooks = getRelicDef("mummified_hand").hooks;
    const self: RelicState = { id: "mummified_hand", counter: 0 };
    const emitted: Effect[] = [];
    hooks.onCardPlayed?.(newRun({ runId: "mh", seed: 1 }), self, "power", e => emitted.push(e));
    expect(emitted).toEqual([{ kind: "make_random_hand_card_free" }]);
    const none: Effect[] = [];
    hooks.onCardPlayed?.(newRun({ runId: "mh2", seed: 1 }), self, "attack", e => none.push(e));
    expect(none).toEqual([]);
  });
});
