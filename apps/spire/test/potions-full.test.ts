import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { potionPoolOfRarity, shopPotionPool } from "../src/engine/potions/potions.js";
import type { GameState } from "../src/engine/types.js";

// 药水补全：新原语 gain_max_hp、新药水效果、角色专属药水锁池。

function combat(character: GameState["character"] = "ironclad", encounter = "cultist"): GameState {
  const s = newRun({ runId: "potion", seed: 6, character });
  startCombat(s, encounter);
  s.hp = 100;
  s.maxHp = 100;
  return s;
}

function drink(s: GameState, potionId: string, target: number | null = null): void {
  s.potions[0] = potionId;
  const r = usePotion(s, 0, target);
  expect(r.ok).toBe(true);
}

describe("新原语：永久提升最大生命", () => {
  it("果汁 +5 最大生命并回复 5", () => {
    const s = combat();
    s.hp = 50;
    drink(s, "fruit_juice");
    expect(s.maxHp).toBe(105);
    expect(s.hp).toBe(55);
  });
});

describe("通用新药水", () => {
  it("剧毒药水给目标 6 层中毒", () => {
    const s = combat();
    drink(s, "poison_potion", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBe(6);
  });

  it("铁心药水给 6 层金属化", () => {
    const s = combat();
    drink(s, "heart_of_iron_potion");
    expect(getPower(s.combat!.playerPowers, "metallicize")).toBe(6);
  });
});

describe("角色专属药水效果", () => {
  it("狡诈药水给静默 3 张飞刀", () => {
    const s = combat("silent");
    const before = s.combat!.hand.filter(c => c.defId === "shiv").length;
    drink(s, "cunning_potion");
    const after = s.combat!.hand.filter(c => c.defId === "shiv").length;
    expect(after).toBe(before + 3);
  });

  it("集中药水给机器人 2 点集中", () => {
    const s = combat("defect");
    drink(s, "focus_potion");
    expect(getPower(s.combat!.playerPowers, "focus")).toBe(2);
  });

  it("瓶装奇迹给观者 2 张奇迹", () => {
    const s = combat("watcher");
    const before = s.combat!.hand.filter(c => c.defId === "miracle").length;
    drink(s, "bottled_miracle");
    const after = s.combat!.hand.filter(c => c.defId === "miracle").length;
    expect(after).toBe(before + 2);
  });
});

describe("角色专属药水只进对应角色的池", () => {
  it("集中药水只在机器人的普通药水池", () => {
    expect(potionPoolOfRarity("common", "defect")).toContain("focus_potion");
    expect(potionPoolOfRarity("common", "ironclad")).not.toContain("focus_potion");
    expect(potionPoolOfRarity("common")).not.toContain("focus_potion"); // 无角色=纯通用
  });

  it("狡诈药水只在静默商店池；观者不含", () => {
    expect(shopPotionPool("silent")).toContain("cunning_potion");
    expect(shopPotionPool("watcher")).not.toContain("cunning_potion");
  });

  it("通用药水对所有角色可得", () => {
    for (const c of ["ironclad", "silent", "defect", "watcher"] as const) {
      expect(shopPotionPool(c)).toContain("poison_potion");
      expect(potionPoolOfRarity("rare", c)).toContain("fruit_juice");
    }
  });
});
