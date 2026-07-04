import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 编织（预知时从弃牌堆收回）/ 祈愿（获得力量，消耗）。

function combat(): GameState {
  const s = newRun({ runId: "wv", seed: 54, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("编织：预知时从弃牌堆收回手牌", () => {
  it("打出进弃牌堆，预知后收回", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "weave", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "weave")).toBe(true);
    // 抽牌堆放几张普通牌，打出「切割命运」（含预知）触发编织收回。
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [{ uid: s.nextUid++, defId: "cut_through_fate", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "weave")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "weave")).toBe(false);
  });
});

describe("祈愿：获得力量并消耗", () => {
  it("获得 3 点力量，进消耗堆", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "wish", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(3);
    expect(s.combat!.exhaustPile.some(c => c.defId === "wish")).toBe(true);
  });
});
