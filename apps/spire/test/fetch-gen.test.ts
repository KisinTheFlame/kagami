import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 检索 / 置顶 / 随机生成：头槌 / 秘密武器 / 秘密技巧 / 搜寻 / 全能。

function combat(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "fg", seed: 23, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("头槌：置顶弃牌", () => {
  it("造成伤害并把最近弃牌置于抽牌堆顶", () => {
    const s = combat();
    s.combat!.discardPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "bash", upgraded: false }, // 最近一张
    ];
    s.combat!.drawPile = [];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "headbutt", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 9);
    // bash 被移到抽牌堆顶（末端）。
    expect(s.combat!.drawPile[s.combat!.drawPile.length - 1]!.defId).toBe("bash");
    expect(s.combat!.discardPile.some(c => c.defId === "bash")).toBe(false);
  });
});

describe("检索", () => {
  it("秘密武器：从抽牌堆检索一张攻击牌", () => {
    const s = combat();
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    play(s, "secret_weapon", null);
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.drawPile.some(c => c.defId === "strike")).toBe(false);
  });

  it("秘密技巧：从抽牌堆检索一张技能牌", () => {
    const s = combat();
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    play(s, "secret_technique", null);
    expect(s.combat!.hand.some(c => c.defId === "defend")).toBe(true);
  });

  it("搜寻：检索任意一张", () => {
    const s = combat();
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    play(s, "seek", null);
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.drawPile).toHaveLength(0);
  });
});

describe("全能：随机无色卡", () => {
  it("加入一张无色卡", () => {
    const s = combat();
    s.combat!.hand = [];
    play(s, "jack_of_all_trades", null);
    // 全能自身消耗；手牌里应多出 1 张无色卡。
    const nonExhausted = s.combat!.hand;
    expect(nonExhausted.length).toBe(1);
    expect(getCardDef(nonExhausted[0]!.defId).color).toBe("colorless");
  });
});
