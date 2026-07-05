import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardType, CharacterId, GameState } from "../src/engine/types.js";

// PR7（药水补全批次 2）：牌生成 / 增益 / 姿态 / 球槽——均映射既有 effect 原语。

function combat(potion: string, character: CharacterId = "ironclad"): GameState {
  const s = newRun({ runId: "pot", seed: 5, character });
  startCombat(s, "cultist");
  s.hp = 200;
  s.maxHp = 200;
  s.potions[0] = potion;
  return s;
}

function handHasFreeCardOfType(s: GameState, type: CardType): boolean {
  return s.combat!.hand.some(c => getCardDef(c.defId).type === type && c.costZero === true);
}

describe("牌生成药水", () => {
  it("攻击药水：手牌多一张 0 费攻击牌", () => {
    const s = combat("attack_potion");
    s.combat!.hand = [];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(handHasFreeCardOfType(s, "attack")).toBe(true);
  });

  it("能力药水：手牌多一张 0 费能力牌", () => {
    const s = combat("power_potion");
    s.combat!.hand = [];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(handHasFreeCardOfType(s, "power")).toBe(true);
  });

  it("无色药水：手牌多一张无色牌", () => {
    const s = combat("colorless_potion");
    s.combat!.hand = [];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.some(c => getCardDef(c.defId).color === "colorless")).toBe(true);
  });
});

describe("增益药水", () => {
  it("灵活药水：+5 临时力量", () => {
    const s = combat("flex_potion");
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(5);
    expect(getPower(s.combat!.playerPowers, "strength_temp")).toBe(5);
  });

  it("瓶中幽魂：获得 1 层虚无缥缈", () => {
    const s = combat("ghost_in_a_jar");
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "intangible")).toBe(1);
  });

  it("熔炉祝福：升级手牌全部牌", () => {
    const s = combat("blessing_of_the_forge");
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.every(c => c.upgraded)).toBe(true);
  });
});

describe("角色专属药水", () => {
  it("神仙玉酿（观者）：进入神性姿态", () => {
    const s = combat("ambrosia", "watcher");
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerStance).toBe("divinity");
  });

  it("容量药水（机器人）：+2 球槽", () => {
    const s = combat("potion_of_capacity", "defect");
    const slots = s.combat!.orbSlots;
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.orbSlots).toBe(slots + 2);
  });
});
