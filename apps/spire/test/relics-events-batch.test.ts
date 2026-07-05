import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, usePotion } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState, RelicState } from "../src/engine/types.js";

function card(s: GameState, defId: string): CardInstance {
  return { uid: s.nextUid++, defId, upgraded: false };
}

describe("onAddCard 遗物钩子", () => {
  it("陶瓷鱼：加牌 +9 金币", () => {
    const s = newRun({ runId: "cf", seed: 1, character: "ironclad" });
    const self: RelicState = { id: "ceramic_fish", counter: 0 };
    const g = s.gold;
    getRelicDef("ceramic_fish").hooks.onAddCard!(s, self, card(s, "strike"));
    expect(s.gold).toBe(g + 9);
  });
  it("熔岩蛋：加入的攻击牌自动升级", () => {
    const s = newRun({ runId: "me", seed: 1, character: "ironclad" });
    const self: RelicState = { id: "molten_egg", counter: 0 };
    const c = card(s, "strike");
    getRelicDef("molten_egg").hooks.onAddCard!(s, self, c);
    expect(c.upgraded).toBe(true);
  });
  it("暗石护符：加入诅咒牌 +6 最大生命", () => {
    const s = newRun({ runId: "dp", seed: 1, character: "ironclad" });
    const self: RelicState = { id: "darkstone_periapt", counter: 0 };
    const m = s.maxHp;
    getRelicDef("darkstone_periapt").hooks.onAddCard!(s, self, card(s, "regret"));
    expect(s.maxHp).toBe(m + 6);
  });
  it("御守：抵消 2 张诅咒后失效", () => {
    const s = newRun({ runId: "om", seed: 1, character: "ironclad" });
    const self: RelicState = { id: "omamori", counter: 0 };
    const hook = getRelicDef("omamori").hooks.onAddCard!;
    for (let i = 0; i < 3; i += 1) {
      const c = card(s, "injury");
      s.deck.push(c);
      hook(s, self, c);
    }
    // 前两张被抵消（移除），第三张留下。
    expect(s.deck.filter(c => c.defId === "injury")).toHaveLength(1);
    expect(self.counter).toBe(2);
  });
});

describe("boss +1 能量遗物", () => {
  it("灵质：战斗开始能量与上限 +1", () => {
    const s = newRun({ runId: "ec", seed: 1, character: "ironclad" });
    grantRelic(s, "ectoplasm");
    startCombat(s, "cultist");
    expect(s.combat!.maxEnergy).toBe(4);
  });
});

describe("天鹅绒项圈：每回合最多 6 张牌", () => {
  it("第 7 张被拒", () => {
    const s = newRun({ runId: "vc", seed: 1, character: "ironclad" });
    grantRelic(s, "velvet_choker");
    startCombat(s, "cultist");
    s.hp = 300;
    s.combat!.hand = Array.from({ length: 7 }, () => card(s, "defend"));
    s.combat!.energy = 99;
    for (let i = 0; i < 6; i += 1) expect(playCard(s, 0, null).ok).toBe(true);
    expect(playCard(s, 0, null).ok).toBe(false);
  });
});

describe("迅捷药水：+5 敏捷", () => {
  it("使用后敏捷 5", () => {
    const s = newRun({ runId: "sp", seed: 1, character: "ironclad" });
    startCombat(s, "cultist");
    s.potions[0] = "speed_potion";
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(5);
  });
});
