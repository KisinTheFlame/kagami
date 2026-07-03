import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { costOf, getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// A2 批次：技能/工具卡（全用既有原语）+ double_block + upgradedCost + 负力量 + 虚无。

function combat(encounter = "gremlin_gang"): GameState {
  const s = newRun({ runId: "batch", seed: 1 });
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  for (const e of s.combat!.enemies) {
    e.hp = 100;
    e.maxHp = 100;
    e.block = 0;
    e.powers = [];
  }
  return s;
}

function play(s: GameState, defId: string, upgraded = false, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("升级降费（upgradedCost 泛化）", () => {
  it("见红/力压/坚守 升级后费用", () => {
    expect(costOf(getCardDef("seeing_red"), false)).toBe(1);
    expect(costOf(getCardDef("seeing_red"), true)).toBe(0);
    expect(costOf(getCardDef("body_slam"), true)).toBe(0);
    expect(costOf(getCardDef("entrench"), true)).toBe(1);
  });
});

describe("坚守：格挡翻倍", () => {
  it("当前格挡 8 → 16", () => {
    const s = combat();
    s.combat!.playerBlock = 8;
    play(s, "entrench");
    expect(s.combat!.playerBlock).toBe(16);
  });
});

describe("AoE 减益", () => {
  it("恫吓给所有敌人虚弱并消耗", () => {
    const s = combat();
    play(s, "intimidate");
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "weak")).toBe(1);
    }
    expect(s.combat!.exhaustPile.some(c => c.defId === "intimidate")).toBe(true);
  });

  it("震荡波给所有敌人虚弱+易伤", () => {
    const s = combat();
    play(s, "shockwave");
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "weak")).toBe(3);
      expect(getPower(e.powers, "vulnerable")).toBe(3);
    }
  });
});

describe("缴械：削力量（可为负）", () => {
  it("敌人力量 -2", () => {
    const s = combat();
    play(s, "disarm", false, 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(-2);
    expect(s.combat!.exhaustPile.some(c => c.defId === "disarm")).toBe(true);
  });
});

describe("资源类", () => {
  it("放血：失 3 血 + 2 能量", () => {
    const s = combat();
    s.hp = 100;
    s.combat!.energy = 3;
    play(s, "bloodletting");
    expect(s.hp).toBe(97);
    expect(s.combat!.energy).toBe(5); // 0费，3-0+2
  });

  it("见红：+2 能量并消耗", () => {
    const s = combat();
    s.combat!.energy = 3;
    play(s, "seeing_red");
    expect(s.combat!.energy).toBe(4); // 1费，3-1+2
    expect(s.combat!.exhaustPile.some(c => c.defId === "seeing_red")).toBe(true);
  });

  it("强渡：+15 格挡 + 手牌两张伤口", () => {
    const s = combat();
    play(s, "power_through");
    expect(s.combat!.playerBlock).toBe(15);
    expect(s.combat!.hand.filter(c => c.defId === "wound")).toHaveLength(2);
  });
});

describe("虚魂护甲：虚无", () => {
  it("打出给 10 格挡", () => {
    const s = combat();
    play(s, "ghostly_armor");
    expect(s.combat!.playerBlock).toBe(10);
  });

  it("回合结束仍在手 → 被消耗（虚无）", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "ghostly_armor", upgraded: false };
    s.combat!.hand = [card];
    endTurn(s);
    expect(s.combat!.exhaustPile.some(c => c.defId === "ghostly_armor")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "ghostly_armor")).toBe(false);
  });
});
