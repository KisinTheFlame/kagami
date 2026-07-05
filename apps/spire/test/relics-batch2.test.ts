import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { Effect, GameState } from "../src/engine/types.js";

// PR6：遗物钩子总线扩展（onEquip / onLoseHp）+ 通用普通遗物批次。

function run(): GameState {
  return newRun({ runId: "r6", seed: 4, character: "ironclad" });
}

describe("onEquip 一次性效果", () => {
  it("草莓：最大生命 +7", () => {
    const s = run();
    const maxHp = s.maxHp;
    grantRelic(s, "strawberry");
    expect(s.maxHp).toBe(maxHp + 7);
    expect(s.hp).toBe(maxHp + 7);
  });

  it("药水腰带：+2 药水槽", () => {
    const s = run();
    const slots = s.potions.length;
    grantRelic(s, "potion_belt");
    expect(s.potions.length).toBe(slots + 2);
  });

  it("磨刀石：升级 2 张攻击牌", () => {
    const s = run();
    grantRelic(s, "whetstone");
    const upgradedAttacks = s.deck.filter(
      c => c.upgraded && getCardDef(c.defId).type === "attack",
    ).length;
    expect(upgradedAttacks).toBe(2);
  });

  it("战争彩绘：升级 2 张技能牌", () => {
    const s = run();
    grantRelic(s, "war_paint");
    const upgradedSkills = s.deck.filter(
      c => c.upgraded && getCardDef(c.defId).type === "skill",
    ).length;
    expect(upgradedSkills).toBe(2);
  });
});

describe("战斗开始钩子", () => {
  it("赤红牛铃：战斗开始给活力 8，第一张攻击 +8 伤害", () => {
    const s = run();
    grantRelic(s, "akabeko");
    startCombat(s, "cultist");
    expect(getPower(s.combat!.playerPowers, "vigor")).toBe(8);
    const before = s.combat!.enemies[0]!.hp;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(before - s.combat!.enemies[0]!.hp).toBe(6 + 8);
  });

  it("行囊：第一回合多抽 2 张（起手 7 张）", () => {
    const s = run();
    grantRelic(s, "bag_of_preparation");
    startCombat(s, "cultist");
    expect(s.combat!.hand).toHaveLength(7);
  });
});

describe("战靴：无格挡攻击伤害 ≤4 改为 5", () => {
  it("飞刀 4 伤 → 5 伤", () => {
    const s = run();
    grantRelic(s, "the_boot");
    startCombat(s, "cultist");
    const before = s.combat!.enemies[0]!.hp;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "shiv", upgraded: false }];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(before - s.combat!.enemies[0]!.hp).toBe(5);
  });
});

describe("百年谜题：每场首次失血抽 3（onLoseHp 钩子）", () => {
  it("首次失血 emit 抽 3，之后不再触发", () => {
    const s = run();
    const self = { id: "centennial_puzzle", counter: 0 };
    const hooks = getRelicDef("centennial_puzzle").hooks;
    hooks.onCombatStart?.(s, self, () => {});
    const emitted: Effect[] = [];
    hooks.onLoseHp?.(s, self, e => emitted.push(e));
    hooks.onLoseHp?.(s, self, e => emitted.push(e)); // 第二次不应再抽
    expect(emitted).toEqual([{ kind: "draw", amount: 3 }]);
  });
});
