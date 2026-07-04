import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// X 费牌：打出消耗全部能量，X = 消耗量，*_x 效果按 X 结算。

function combat(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "x", seed: 8, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function playX(s: GameState, defId: string, energy: number, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("旋风斩：对全体 X 次", () => {
  it("3 能量 → 对敌人造成 5×3 伤害并耗光能量", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    playX(s, "whirlwind", 3, null);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 15);
    expect(s.combat!.energy).toBe(0);
  });

  it("0 能量 → X=0，无伤害，可打出", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    playX(s, "whirlwind", 0, null);
    expect(s.combat!.enemies[0]!.hp).toBe(before);
  });
});

describe("穿刺：对目标 X 次", () => {
  it("4 能量 → 7×4 单体伤害", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    playX(s, "skewer", 4, 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 28);
  });
});

describe("强化机体：格挡 X 次", () => {
  it("3 能量 → 7×3 格挡", () => {
    const s = combat("defect");
    s.combat!.playerBlock = 0;
    playX(s, "reinforced_body", 3, null);
    expect(s.combat!.playerBlock).toBe(21);
  });
});

describe("萎靡：-X 力量 + X 虚弱", () => {
  it("2 能量 → 目标 -2 力量、2 虚弱", () => {
    const s = combat();
    s.combat!.enemies[0]!.powers.push({ id: "strength", amount: 5 });
    playX(s, "malaise", 2, 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(3);
    expect(getPower(s.combat!.enemies[0]!.powers, "weak")).toBe(2);
  });
});

describe("多重唤醒：唤醒 X 颗球", () => {
  it("机器人 2 能量 + 2 颗闪电球 → 唤醒 2 颗", () => {
    const s = combat("defect");
    s.combat!.orbs = [{ type: "lightning" }, { type: "lightning" }];
    playX(s, "multi_evoke", 2, null);
    expect(s.combat!.orbs.length).toBe(0);
  });
});

describe("卡池归属", () => {
  it("X 费牌进入正确颜色池", () => {
    expect(cardPoolOf("red", "uncommon")).toContain("whirlwind");
    expect(cardPoolOf("green", "uncommon")).toContain("skewer");
    expect(cardPoolOf("green", "rare")).toContain("malaise");
    expect(cardPoolOf("blue", "rare")).toContain("multi_evoke");
  });
});
