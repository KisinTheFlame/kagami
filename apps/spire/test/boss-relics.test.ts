import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { GameState } from "../src/engine/types.js";

// 首领遗物奖励通路 + boss 遗物批次。

function combatWith(relic: string, encounter = "cultist", character = "ironclad"): GameState {
  const s = newRun({ runId: "br", seed: 3, character: character as GameState["character"] });
  grantRelic(s, relic);
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("首领遗物奖励：打首领掉一件 boss 遗物", () => {
  it("击败守卫者 → 获得一件 boss 稀有度遗物", () => {
    const s = newRun({ runId: "boss", seed: 5, character: "ironclad" });
    startCombat(s, "guardian");
    const relicsBefore = s.relics.length;
    s.combat!.enemies[0]!.hp = 3;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.energy = 3;
    s.version = 1;
    applyAction(s, { type: "play_card", handIndex: 0, targetIndex: 0 });
    expect(s.relics.length).toBe(relicsBefore + 1);
    const gained = getRelicDef(s.relics[s.relics.length - 1]!.id);
    expect(gained.rarity).toBe("boss");
  });
});

describe("+1 能量类", () => {
  it("咖啡滴滤器：回合能量与上限各 +1", () => {
    const s = combatWith("coffee_dripper");
    expect(s.combat!.maxEnergy).toBe(4);
    expect(s.combat!.energy).toBe(4);
  });
});

describe("斗笠：无法使用药水", () => {
  it("使用药水被拦截", () => {
    const s = combatWith("sozu");
    s.potions[0] = "block_potion";
    expect(usePotion(s, 0, null).ok).toBe(false);
  });
});

describe("贤者之石：敌人开局各 +1 力量", () => {
  it("双敌各获得 1 力量", () => {
    const s = combatWith("philosophers_stone", "two_louse");
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "strength")).toBe(1);
    }
  });
});

describe("痛苦烙印：开局放 2 张伤口进抽牌堆", () => {
  it("牌堆里共 2 张伤口", () => {
    const s = combatWith("mark_of_pain");
    const wounds = [...s.combat!.hand, ...s.combat!.drawPile, ...s.combat!.discardPile].filter(
      c => c.defId === "wound",
    );
    expect(wounds).toHaveLength(2);
  });
});

describe("onEquip 类 boss 遗物", () => {
  it("空笼：获得时移除 2 张牌", () => {
    const s = newRun({ runId: "cage", seed: 1, character: "ironclad" });
    const size = s.deck.length;
    grantRelic(s, "empty_cage");
    expect(s.deck.length).toBe(size - 2);
  });

  it("小屋：+6 最大生命 +50 金币 + 升 1 牌", () => {
    const s = newRun({ runId: "house", seed: 1, character: "ironclad" });
    const maxHp = s.maxHp;
    const gold = s.gold;
    grantRelic(s, "tiny_house");
    expect(s.maxHp).toBe(maxHp + 6);
    expect(s.gold).toBe(gold + 50);
    expect(s.deck.filter(c => c.upgraded).length).toBe(1);
  });
});
