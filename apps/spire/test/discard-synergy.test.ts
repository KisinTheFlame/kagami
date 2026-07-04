import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { GameState } from "../src/engine/types.js";

// 弃牌联动：声东击西（弃过牌给能量）/ 剖体斩（弃牌降费）。cardsDiscardedThisTurn 计数。

function combat(): GameState {
  const s = newRun({ runId: "disc", seed: 37, character: "silent" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("声东击西：弃过牌才回能量", () => {
  it("本回合弃过牌 → 打出后净回 0 能量（花 2 得 2）", () => {
    const s = combat();
    s.combat!.cardsDiscardedThisTurn = 1;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "sneaky_strike", upgraded: false }];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(3); // 3 - 2 + 2。
  });

  it("本回合未弃牌 → 不回能量", () => {
    const s = combat();
    s.combat!.cardsDiscardedThisTurn = 0;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "sneaky_strike", upgraded: false }];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(1); // 3 - 2。
  });
});

describe("剖体斩：弃牌降费", () => {
  it("弃过 2 张 → 费用 3-2=1", () => {
    const s = combat();
    s.combat!.cardsDiscardedThisTurn = 2;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "eviscerate", upgraded: false }];
    s.combat!.energy = 1; // 只够降费后的 1。
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 21); // 7×3。
  });

  it("未弃牌 → 原价 3，能量不足打不出", () => {
    const s = combat();
    s.combat!.cardsDiscardedThisTurn = 0;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "eviscerate", upgraded: false }];
    s.combat!.energy = 2;
    expect(playCard(s, 0, 0).ok).toBe(false);
  });
});

describe("弃牌效果推进 cardsDiscardedThisTurn", () => {
  it("卸货弃掉非攻击牌后计数增加", () => {
    const s = combat();
    s.combat!.cardsDiscardedThisTurn = 0;
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "unload", upgraded: false }, // 卸货：弃所有非攻击
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 两张 defend 被弃。
    expect(s.combat!.cardsDiscardedThisTurn).toBe(2);
  });
});
