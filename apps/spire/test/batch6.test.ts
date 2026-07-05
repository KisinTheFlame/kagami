import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 收尾 6 卡：神化/应急按钮/炸弹/外来影响/机械降神/电动力学。

function combat(character: "ironclad" | "watcher" | "defect"): GameState {
  const s = newRun({ runId: "bt6", seed: 62, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  if (character === "defect") {
    s.combat!.orbs = [];
    s.combat!.orbSlots = 10;
  }
  return s;
}

describe("神化：升级所有牌", () => {
  it("手牌与抽牌堆里的牌都变升级", () => {
    const s = combat("ironclad");
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "apotheosis", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.every(c => c.upgraded)).toBe(true);
    expect(s.combat!.drawPile.every(c => c.upgraded)).toBe(true);
  });
});

describe("应急按钮：格挡但之后禁牌格挡", () => {
  it("先获得 30 格挡，随后牌格挡被抑制", () => {
    const s = combat("ironclad");
    s.combat!.playerBlock = 0;
    const card: CardInstance = { uid: s.nextUid++, defId: "panic_button", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(30);
    expect(getPower(s.combat!.playerPowers, "no_card_block")).toBe(2);
    // 再打防御，格挡不增加。
    const blockBefore = s.combat!.playerBlock;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "defend", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(blockBefore);
  });
});

describe("炸弹：3 回合后全体爆炸", () => {
  it("倒数 3 回合后对全体造成 40", () => {
    const s = combat("ironclad");
    const card: CardInstance = { uid: s.nextUid++, defId: "the_bomb", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.pendingBomb?.turns).toBe(3);
    s.combat!.enemies[0]!.block = 0;
    const before = s.combat!.enemies[0]!.hp;
    // 三个回合末后爆炸。
    for (let t = 0; t < 3; t++) {
      s.combat!.hand = [];
      s.combat!.enemies[0]!.block = 0;
      s.combat!.enemies[0]!.currentMove = "incantation";
      endTurn(s);
    }
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(40);
    expect(s.combat!.pendingBomb).toBeNull();
  });
});

describe("外来影响：随机免费攻击入手", () => {
  it("加入一张 0 费攻击牌", () => {
    const s = combat("watcher");
    const card: CardInstance = { uid: s.nextUid++, defId: "foreign_influence", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    const added = s.combat!.hand.find(c => c.costZero);
    expect(added).toBeDefined();
    expect(getCardDef(added!.defId).type).toBe("attack");
  });
});

describe("机械降神：抽到即生成奇迹并消耗", () => {
  it("抽到时手里多 2 张奇迹，自身进消耗堆", () => {
    const s = combat("watcher");
    s.combat!.hand = [];
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "deus_ex_machina", upgraded: false }];
    // 打一张抽 1 的牌触发抽到。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "cut_through_fate", upgraded: false }];
    s.combat!.energy = 9;
    playCard(s, 0, 0);
    expect(s.combat!.hand.filter(c => c.defId === "miracle").length).toBe(2);
    expect(s.combat!.exhaustPile.some(c => c.defId === "deus_ex_machina")).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "deus_ex_machina")).toBe(false);
  });
});

describe("电动力学：闪电球命中所有敌人", () => {
  it("挂上后闪电球唤醒对双敌都造成伤害", () => {
    const s = combat("defect");
    s.combat!.enemies.push({ ...s.combat!.enemies[0]!, hp: 40, maxHp: 40, block: 0 });
    s.combat!.enemies[0]!.hp = 40;
    s.combat!.enemies[0]!.block = 0;
    const before0 = s.combat!.enemies[0]!.hp;
    const before1 = s.combat!.enemies[1]!.hp;
    play(s, "electrodynamics", null);
    expect(getPower(s.combat!.playerPowers, "electrodynamics")).toBe(1);
    // 手动唤醒一颗闪电球（充能了 2 颗）。
    s.combat!.orbs = [{ type: "lightning" }];
    play(s, "dualcast", null);
    expect(s.combat!.enemies[0]!.hp).toBeLessThan(before0);
    expect(s.combat!.enemies[1]!.hp).toBeLessThan(before1);
  });
});

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}
