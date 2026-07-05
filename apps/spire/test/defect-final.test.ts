import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// PR1 卡池收尾：机器人缺卡（爪击/回收/双倍能量/平衡/你好世界）+ 虚无状态牌。

function combat(): GameState {
  const s = newRun({ runId: "final", seed: 7, character: "defect" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.orbs = [];
  s.combat!.orbSlots = 10;
  s.combat!.hand = [];
  s.combat!.drawPile = [];
  s.combat!.discardPile = [];
  return s;
}

function card(s: GameState, defId: string, upgraded = false): CardInstance {
  return { uid: s.nextUid++, defId, upgraded };
}

describe("爪击：本场每打出一张 +2，作用于后续所有爪击", () => {
  it("连打两张普通爪击 → 3 + 5 = 8 伤害", () => {
    const s = combat();
    const enemy = s.combat!.enemies[0]!;
    const before = enemy.hp;
    s.combat!.hand = [card(s, "claw"), card(s, "claw")];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(before - s.combat!.enemies[0]!.hp).toBe(3);
    expect(s.combat!.clawDamageThisCombat).toBe(2);
    const mid = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(mid - s.combat!.enemies[0]!.hp).toBe(5);
  });

  it("升级爪击基础 5", () => {
    const s = combat();
    const enemy = s.combat!.enemies[0]!;
    const before = enemy.hp;
    s.combat!.hand = [card(s, "claw", true)];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(before - s.combat!.enemies[0]!.hp).toBe(5);
  });
});

describe("回收：消耗手牌中费用最高的一张，返还等额能量", () => {
  it("消耗费用最高的牌并回能量", () => {
    const s = combat();
    // 手牌：回收 + 一张 cost2（冰川）+ 一张 cost1（防御_蓝）——应挑冰川。
    const costly = card(s, "glacier");
    const costlyCost = getCardDef("glacier").cost as number;
    s.combat!.hand = [card(s, "recycle"), costly, card(s, "defend")];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 打出回收花 1 能量，随后返还冰川费用。
    expect(s.combat!.energy).toBe(3 - 1 + costlyCost);
    expect(s.combat!.exhaustPile.some(c => c.defId === "glacier")).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "glacier")).toBe(false);
    // 回收本身不消耗（进弃牌堆）。
    expect(s.combat!.exhaustPile.some(c => c.defId === "recycle")).toBe(false);
  });
});

describe("双倍能量：获得等同于当前能量的能量", () => {
  it("能量 3 → 打出（费 1 剩 2）→ 翻倍到 4", () => {
    const s = combat();
    s.combat!.hand = [card(s, "double_energy")];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.energy).toBe(4);
  });
});

describe("平衡：获得格挡并本回合保留手牌", () => {
  it("获得 13 格挡；回合结束保留其余手牌不进弃牌堆", () => {
    const s = combat();
    s.combat!.hand = [card(s, "equilibrium"), card(s, "strike"), card(s, "defend")];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(13);
    expect(s.combat!.retainHandThisTurn).toBe(true);
    endTurn(s);
    // strike / defend 应被保留（仍在手），且不在弃牌堆。
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "defend")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "strike")).toBe(false);
    // 「本回合」限定：结算后清零。
    expect(s.combat!.retainHandThisTurn).toBe(false);
  });
});

describe("你好世界：能力牌，每回合开始加一张随机普通牌", () => {
  it("持有能力后回合开始向手牌加入一张普通牌", () => {
    const s = combat();
    s.combat!.playerPowers = [{ id: "hello_world", amount: 1 }];
    endTurn(s); // 走到下一个玩家回合开始
    expect(s.combat!.hand).toHaveLength(1);
    expect(getCardDef(s.combat!.hand[0]!.defId).rarity).toBe("common");
  });

  it("升级后具有固有（upgradedInnate）", () => {
    expect(getCardDef("hello_world").upgradedInnate).toBe(true);
  });
});

describe("虚无：抽到失 1 能量、回合末在手则消耗", () => {
  it("抽到时能量 -1", () => {
    const s = combat();
    s.combat!.drawPile = [card(s, "void")];
    endTurn(s); // 下一个玩家回合：能量重置为上限后抽到虚无 -1
    expect(s.combat!.energy).toBe(s.combat!.maxEnergy - 1);
    expect(s.combat!.hand.some(c => c.defId === "void")).toBe(true);
  });

  it("回合结束时在手牌中被消耗（虚无/ethereal）", () => {
    const s = combat();
    s.combat!.hand = [card(s, "void")];
    endTurn(s);
    expect(s.combat!.exhaustPile.some(c => c.defId === "void")).toBe(true);
  });

  it("无法打出", () => {
    const s = combat();
    s.combat!.hand = [card(s, "void")];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(false);
  });
});
