import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { GameState } from "../src/engine/types.js";

// 急袭斩（打击+抽牌）/ 未卜先知（回合始预知，自动弃状态牌）。

function combat(character: "silent" | "watcher"): GameState {
  const s = newRun({ runId: "fs", seed: 39, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("急袭斩：打击并抽牌", () => {
  it("造成 8 点并抽 1 张", () => {
    const s = combat("silent");
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.hand = [{ uid: s.nextUid++, defId: "quick_slash", upgraded: false }];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 8);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(1);
  });
});

describe("未卜先知：回合开始预知", () => {
  it("获得 foresight 层数，下回合开始自动弃掉牌堆顶的状态牌", () => {
    const s = combat("watcher");
    s.combat!.hand = [{ uid: s.nextUid++, defId: "foresight", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "foresight")).toBe(3);
    // 牌堆顶放一张状态牌 + 足量普通牌（避免抽空回洗把弃掉的 dazed 又抽回来）。
    s.combat!.drawPile = [
      ...Array.from({ length: 10 }, () => ({
        uid: s.nextUid++,
        defId: "strike",
        upgraded: false,
      })),
      { uid: s.nextUid++, defId: "dazed", upgraded: false }, // 顶端（pop 先出）
    ];
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 预知 3 看顶部含 dazed → 自动弃；抽到的手牌里不应有 dazed。
    expect(s.combat!.hand.some(c => c.defId === "dazed")).toBe(false);
    expect(s.combat!.discardPile.some(c => c.defId === "dazed")).toBe(true);
  });
});
