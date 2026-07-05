import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 军备：格挡 + 升级手牌（base 一张 / upgraded 全部）。

function combat(): GameState {
  const s = newRun({ runId: "arm", seed: 63, character: "ironclad" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("军备：格挡并升级手牌", () => {
  it("base 升级一张手牌", () => {
    const s = combat();
    s.combat!.playerBlock = 0;
    const a: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    const b: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [{ uid: s.nextUid++, defId: "armaments", upgraded: false }, a, b];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(5);
    // 恰好升级一张（第一张未升级的 strike）。
    expect([a.upgraded, b.upgraded].filter(Boolean)).toHaveLength(1);
    expect(a.upgraded).toBe(true);
  });

  it("upgraded 升级手牌全部", () => {
    const s = combat();
    const a: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    const b: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [{ uid: s.nextUid++, defId: "armaments", upgraded: true }, a, b];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(a.upgraded).toBe(true);
    expect(b.upgraded).toBe(true);
  });
});
