import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// PR（药水补全批次 3）：牌堆操作 / 药水槽。

function combat(potion: string, slot = 0): GameState {
  const s = newRun({ runId: "p3", seed: 9, character: "ironclad" });
  startCombat(s, "cultist");
  s.hp = 200;
  s.maxHp = 200;
  s.potions[slot] = potion;
  return s;
}

function card(s: GameState, defId: string): CardInstance {
  return { uid: s.nextUid++, defId, upgraded: false };
}

describe("熵酿：填满所有空药水槽", () => {
  it("三空槽 → 全部填满", () => {
    const s = combat("entropic_brew");
    s.potions[1] = null;
    s.potions[2] = null;
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.potions.every(p => p !== null)).toBe(true);
  });
});

describe("赌徒酿：弃手牌抽等量", () => {
  it("弃 3 抽 3", () => {
    const s = combat("gamblers_brew");
    s.combat!.hand = [card(s, "strike"), card(s, "defend"), card(s, "strike")];
    s.combat!.drawPile = [
      card(s, "defend"),
      card(s, "strike"),
      card(s, "defend"),
      card(s, "strike"),
    ];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand).toHaveLength(3);
    expect(s.combat!.discardPile.length).toBeGreaterThanOrEqual(3);
  });
});

describe("灵丹药水：消耗所有非攻击牌", () => {
  it("技能被消耗、攻击保留", () => {
    const s = combat("elixir_potion");
    s.combat!.hand = [card(s, "strike"), card(s, "defend"), card(s, "defend")];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.every(c => getCardDef(c.defId).type === "attack")).toBe(true);
    expect(s.combat!.exhaustPile.some(c => c.defId === "defend")).toBe(true);
  });
});

describe("流质记忆：从弃牌堆取回一张", () => {
  it("弃牌堆的牌被收回手牌", () => {
    const s = combat("liquid_memories");
    s.combat!.hand = [];
    s.combat!.discardPile = [card(s, "bash")];
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "bash")).toBe(true);
  });
});
