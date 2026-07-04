import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 单卡实例自我成长（本场战斗内）：暴走/玻璃刀/坚韧。

function combat(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "inst", seed: 20, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

/** 打出同一张实例对象（模拟抽回后再打，验证 bonus 持续）。 */
function replay(s: GameState, card: CardInstance, target: number | null = 0): void {
  s.combat!.hand = [card];
  s.combat!.discardPile = [];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("暴走：每次打出伤害 +5", () => {
  it("首打 8，再打 13", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "rampage", upgraded: false };
    const e = s.combat!.enemies[0]!;
    let before = e.hp;
    replay(s, card, 0);
    expect(e.hp).toBe(before - 8);
    expect(card.bonus).toBe(5);
    before = e.hp;
    replay(s, card, 0);
    expect(e.hp).toBe(before - 13); // 8 + 5
  });
});

describe("玻璃刀：每次打出伤害 -2", () => {
  it("首打 8×2=16，再打 6×2=12", () => {
    const s = combat("silent");
    const card: CardInstance = { uid: s.nextUid++, defId: "glass_knife", upgraded: false };
    const e = s.combat!.enemies[0]!;
    let before = e.hp;
    replay(s, card, 0);
    expect(e.hp).toBe(before - 16);
    before = e.hp;
    replay(s, card, 0);
    expect(e.hp).toBe(before - 12); // (8-2)×2
  });
});

describe("坚韧：每次打出格挡 +2", () => {
  it("首打 5，再打 7", () => {
    const s = combat("watcher");
    const card: CardInstance = { uid: s.nextUid++, defId: "perseverance", upgraded: false };
    s.combat!.playerBlock = 0;
    replay(s, card, null);
    expect(s.combat!.playerBlock).toBe(5);
    s.combat!.playerBlock = 0;
    replay(s, card, null);
    expect(s.combat!.playerBlock).toBe(7); // 5 + 2
  });
});

describe("成长只在本场战斗内（不写回牌组）", () => {
  it("下场战斗从牌组复制重置 bonus", () => {
    const s = newRun({ runId: "reset", seed: 4, character: "ironclad" });
    const deckCard: CardInstance = { uid: s.nextUid++, defId: "rampage", upgraded: false };
    s.deck.push(deckCard);
    startCombat(s, "cultist");
    // 找到战斗里的暴走副本并打出成长。
    const copy = s.combat!.drawPile.find(c => c.defId === "rampage")!;
    s.combat!.hand = [copy];
    s.combat!.energy = 9;
    playCard(s, 0, 0);
    expect(copy.bonus).toBe(5);
    // 牌组原件不受影响。
    expect(deckCard.bonus).toBeUndefined();
  });
});

describe("卡池归属", () => {
  it("成长卡进入正确池", () => {
    expect(cardPoolOf("red", "uncommon")).toContain("rampage");
    expect(cardPoolOf("green", "uncommon")).toContain("glass_knife");
    expect(cardPoolOf("purple", "common")).toContain("perseverance");
  });
});
