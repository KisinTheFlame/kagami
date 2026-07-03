import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { generateReward } from "../src/engine/run/run.js";
import type { GameState } from "../src/engine/types.js";

// M3e：药水系统——3 槽、战斗掉落、use_potion 动作。数值对齐 sts_lightspeed asc0。

function combat(): GameState {
  const s = newRun({ runId: "potion", seed: 1 });
  startCombat(s, "cultist");
  s.hp = 200;
  s.maxHp = 200;
  s.combat!.enemies[0]!.hp = 100;
  s.combat!.enemies[0]!.maxHp = 100;
  return s;
}

function use(s: GameState, potionId: string, target: number | null = null): void {
  s.potions[0] = potionId;
  const r = usePotion(s, 0, target);
  expect(r.ok).toBe(true);
  expect(s.potions[0]).toBeNull(); // 用后清槽
}

describe("药水槽", () => {
  it("新对局 3 个空槽", () => {
    const s = newRun({ runId: "slots", seed: 1 });
    expect(s.potions).toEqual([null, null, null]);
  });
});

describe("药水效果", () => {
  it("格挡药水 +12 格挡", () => {
    const s = combat();
    use(s, "block_potion");
    expect(s.combat!.playerBlock).toBe(12);
  });

  it("力量/敏捷/能量药水", () => {
    const s = combat();
    use(s, "strength_potion");
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
    const s2 = combat();
    use(s2, "dexterity_potion");
    expect(getPower(s2.combat!.playerPowers, "dexterity")).toBe(2);
    const s3 = combat();
    s3.combat!.energy = 3;
    use(s3, "energy_potion");
    expect(s3.combat!.energy).toBe(5);
  });

  it("火焰药水对目标造成 20", () => {
    const s = combat();
    use(s, "fire_potion", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(80);
  });

  it("爆炸药水对所有敌人造成 10", () => {
    const s = combat();
    s.combat!.enemies.push({ ...s.combat!.enemies[0]!, hp: 50, maxHp: 50 });
    use(s, "explosive_potion");
    expect(s.combat!.enemies[0]!.hp).toBe(90);
    expect(s.combat!.enemies[1]!.hp).toBe(40);
  });

  it("虚弱/恐惧药水施加减益", () => {
    const s = combat();
    use(s, "weak_potion", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "weak")).toBe(3);
    const s2 = combat();
    use(s2, "fear_potion", 0);
    expect(getPower(s2.combat!.enemies[0]!.powers, "vulnerable")).toBe(3);
  });

  it("血之药水回复最大生命 40%", () => {
    const s = combat();
    s.hp = 50;
    s.maxHp = 200;
    use(s, "blood_potion");
    expect(s.hp).toBe(50 + 80); // 40% of 200
  });

  it("迅捷药水抽 3 张", () => {
    const s = combat();
    const before = s.combat!.hand.length;
    use(s, "swift_potion");
    expect(s.combat!.hand.length).toBe(before + 3);
  });
});

describe("使用约束", () => {
  it("空槽用不了", () => {
    const s = combat();
    expect(usePotion(s, 1, null).ok).toBe(false);
  });

  it("战斗限定药水在非战斗屏用不了", () => {
    const s = newRun({ runId: "nocombat", seed: 1 }); // 地图屏
    s.potions[0] = "fire_potion";
    expect(usePotion(s, 0, null).ok).toBe(false);
    expect(s.potions[0]).toBe("fire_potion"); // 未消耗
  });
});

describe("战斗掉落", () => {
  it("掉率拉满则必掉一瓶到空槽、bonus -10", () => {
    const s = newRun({ runId: "drop", seed: 1 });
    s.potionDropBonus = 100; // 有效 100%
    generateReward(s);
    expect(s.potions.filter(p => p !== null)).toHaveLength(1);
    expect(s.potionDropBonus).toBe(90);
  });

  it("掉率为 0 则不掉、bonus +10", () => {
    const s = newRun({ runId: "nodrop", seed: 1 });
    s.potionDropBonus = -100; // 有效 0%
    generateReward(s);
    expect(s.potions.every(p => p === null)).toBe(true);
    expect(s.potionDropBonus).toBe(-90);
  });

  it("槽满则不掉", () => {
    const s = newRun({ runId: "full", seed: 1 });
    s.potions = ["fire_potion", "block_potion", "strength_potion"];
    s.potionDropBonus = 100;
    generateReward(s);
    expect(s.potions).toEqual(["fire_potion", "block_potion", "strength_potion"]);
  });
});
