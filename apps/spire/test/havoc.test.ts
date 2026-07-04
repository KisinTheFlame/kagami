import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 点穴（标记 + 全体按标记掉血）/ 浩劫（打出并消耗牌堆顶）。

function combat(character: "watcher" | "ironclad"): GameState {
  const s = newRun({ runId: "hv", seed: 55, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("点穴：标记后全体按标记掉血", () => {
  it("给目标 8 标记，随后其损失 8 生命（无视格挡）", () => {
    const s = combat("watcher");
    s.combat!.enemies[0]!.block = 100; // 掉血无视格挡
    const before = s.combat!.enemies[0]!.hp;
    const card: CardInstance = { uid: s.nextUid++, defId: "pressure_points", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(getPower(s.combat!.enemies[0]!.powers, "mark")).toBe(8);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 8);
  });
});

describe("浩劫：打出并消耗抽牌堆顶", () => {
  it("顶部是打击 → 打出造成伤害并消耗", () => {
    const s = combat("ironclad");
    s.combat!.enemies[0]!.block = 0;
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    const before = s.combat!.enemies[0]!.hp;
    const card: CardInstance = { uid: s.nextUid++, defId: "havoc", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 顶部的打击被打出（6 伤害）并消耗。
    expect(s.combat!.enemies[0]!.hp).toBe(before - 6);
    expect(s.combat!.exhaustPile.some(c => c.defId === "strike")).toBe(true);
    // 浩劫自身进弃牌堆。
    expect(s.combat!.discardPile.some(c => c.defId === "havoc")).toBe(true);
  });

  it("抽牌堆为空 → 无事发生", () => {
    const s = combat("ironclad");
    s.combat!.drawPile = [];
    const card: CardInstance = { uid: s.nextUid++, defId: "havoc", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
  });
});
