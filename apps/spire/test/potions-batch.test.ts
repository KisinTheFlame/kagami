import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import {
  COMMON_POTION_POOL,
  RARE_POTION_POOL,
  getPotionDef,
} from "../src/engine/potions/potions.js";
import type { GameState } from "../src/engine/types.js";

// A4：再生/镀甲/玩家神器/玩家仪式 + 4 新药水 + 药水稀有度。

function combat(): GameState {
  const s = newRun({ runId: "pot", seed: 1 });
  startCombat(s, "cultist");
  s.hp = 100;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function drink(s: GameState, potionId: string): void {
  s.potions[0] = potionId;
  expect(usePotion(s, 0, null).ok).toBe(true);
}

describe("再生药水", () => {
  it("5 层再生：每回合末回血且层数递减", () => {
    const s = combat();
    drink(s, "regen_potion");
    expect(getPower(s.combat!.playerPowers, "regen")).toBe(5);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation"; // 敌人首招不攻击
    endTurn(s);
    expect(s.hp).toBe(105); // 回 5
    expect(getPower(s.combat!.playerPowers, "regen")).toBe(4); // 递减
  });
});

describe("钢铁精华：镀甲", () => {
  it("每回合末 +4 格挡；被穿甲攻击 -1 层", () => {
    const s = combat();
    drink(s, "essence_of_steel");
    expect(getPower(s.combat!.playerPowers, "plated_armor")).toBe(4);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 暗袭 6
    endTurn(s);
    // 回合末 +4 镀甲格挡挡下 6 中的 4，剩 2 穿透 → 镀甲 -1 层
    expect(s.hp).toBe(100 - 2);
    expect(getPower(s.combat!.playerPowers, "plated_armor")).toBe(3);
  });
});

describe("远古药水：玩家神器", () => {
  it("神器抵消下一个敌人施加的减益（酸液史莱姆舔舐→虚弱被吃掉）", () => {
    const s = newRun({ runId: "art", seed: 1 });
    startCombat(s, "large_slime_acid"); // 大酸液史莱姆，有 lick_l（给玩家虚弱）
    s.hp = 200;
    s.maxHp = 200;
    s.potions[0] = "ancient_potion";
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "artifact")).toBe(1);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "lick_l"; // 施加虚弱
    endTurn(s);
    // 神器吃掉虚弱：玩家无虚弱，神器消耗到 0
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(0);
    expect(getPower(s.combat!.playerPowers, "artifact")).toBe(0);
  });
});

describe("邪教徒药水：玩家仪式", () => {
  it("每回合开始 +1 力量", () => {
    const s = combat();
    drink(s, "cultist_potion");
    expect(getPower(s.combat!.playerPowers, "ritual")).toBe(1);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(0); // 当回合还没触发
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s); // 下一回合开始 → +1 力量
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(1);
  });
});

describe("药水稀有度", () => {
  it("新药水入对应稀有度池", () => {
    expect(COMMON_POTION_POOL).toContain("block_potion");
    expect(RARE_POTION_POOL).toContain("cultist_potion");
    expect(getPotionDef("regen_potion").rarity).toBe("uncommon");
    expect(getPotionDef("essence_of_steel").rarity).toBe("uncommon");
    expect(getPotionDef("ancient_potion").rarity).toBe("uncommon");
  });
});
