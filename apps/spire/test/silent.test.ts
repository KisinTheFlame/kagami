import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getCharacterConfig } from "../src/engine/characters/characters.js";
import { generateReward } from "../src/engine/run/run.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// C2：静默猎手——中毒机制 + 飞刀 + 绿色卡池 + 蛇之戒指。

function silentCombat(encounter = "cultist"): GameState {
  const s = newRun({ runId: "silent", seed: 1, character: "silent" });
  startCombat(s, encounter);
  s.hp = 200;
  s.maxHp = 200;
  s.combat!.enemies[0]!.hp = 100;
  s.combat!.enemies[0]!.maxHp = 100;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("静默角色配置", () => {
  it("70 血、绿色、蛇之戒指、12 张起始牌（含中和+幸存者）", () => {
    const c = getCharacterConfig("silent");
    expect(c.maxHp).toBe(70);
    expect(c.color).toBe("green");
    expect(c.starterRelic).toBe("ring_of_the_snake");
    const s = newRun({ runId: "s", seed: 1, character: "silent" });
    expect(s.maxHp).toBe(70);
    expect(s.deck).toHaveLength(12);
    expect(s.deck.filter(c => c.defId === "neutralize")).toHaveLength(1);
    expect(s.deck.filter(c => c.defId === "survivor")).toHaveLength(1);
  });

  it("蛇之戒指：第一回合抽 7 张（5+2）", () => {
    const s = newRun({ runId: "ring", seed: 1, character: "silent" });
    startCombat(s, "cultist");
    expect(s.combat!.hand).toHaveLength(7);
  });
});

describe("中毒机制", () => {
  it("淬毒之刺：造成 6 + 3 层中毒；敌人回合开始扣毒并递减", () => {
    const s = silentCombat();
    play(s, "poisoned_stab", 0);
    const enemy = s.combat!.enemies[0]!;
    expect(enemy.hp).toBe(94); // 6 伤
    expect(getPower(enemy.powers, "poison")).toBe(3);
    s.combat!.hand = [];
    endTurn(s);
    const e = s.combat!.enemies[0]!;
    expect(e.hp).toBe(91); // 毒 3
    expect(getPower(e.powers, "poison")).toBe(2); // 递减
  });

  it("中毒无视格挡", () => {
    const s = silentCombat();
    const enemy = s.combat!.enemies[0]!;
    enemy.powers.push({ id: "poison", amount: 5 });
    enemy.block = 50;
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBe(95); // 直接扣血，不理会 50 格挡
  });

  it("中毒可致死并结束战斗", () => {
    const s = silentCombat();
    const enemy = s.combat!.enemies[0]!;
    enemy.hp = 3;
    enemy.powers.push({ id: "poison", amount: 5 });
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat).toBeNull(); // 毒死 → 战斗结束（combat 清空）
  });
});

describe("飞刀", () => {
  it("剑刃之舞加 3 张飞刀入手；飞刀造成 4 且消耗", () => {
    const s = silentCombat();
    s.combat!.hand = [];
    play(s, "blade_dance", null);
    // 打出后手里应有 3 张飞刀（blade_dance 本身已移出）
    const shivs = s.combat!.hand.filter(c => c.defId === "shiv");
    expect(shivs.length).toBeGreaterThanOrEqual(3);
    // 打一张飞刀
    const before = s.combat!.enemies[0]!.hp;
    const shivIdx = s.combat!.hand.findIndex(c => c.defId === "shiv");
    s.combat!.energy = 9;
    expect(playCard(s, shivIdx, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 4);
    expect(s.combat!.exhaustPile.some(c => c.defId === "shiv")).toBe(true); // 消耗
  });
});

describe("绿色卡池", () => {
  it("静默奖励只给绿色卡", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const s = newRun({ runId: `g${seed}`, seed, character: "silent" });
      generateReward(s);
      for (const choice of s.reward!.cardChoices) {
        expect(getCardDef(choice.defId).color).toBe("green");
      }
    }
  });
});
