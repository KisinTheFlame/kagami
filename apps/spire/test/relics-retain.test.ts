import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { grantRelic } from "../src/engine/relics/relics.js";
import type { GameState } from "../src/engine/types.js";

function combat(relic: string): GameState {
  const s = newRun({ runId: relic, seed: 1, character: "ironclad" });
  grantRelic(s, relic);
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.drawPile = []; // 隔离：下回合不抽新牌
  return s;
}

describe("卡钳：回合开始只失 15 格挡", () => {
  it("40 格挡 → 下回合剩 25", () => {
    const s = combat("calipers");
    s.combat!.playerBlock = 40;
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.playerBlock).toBe(25);
  });
});

describe("符文金字塔：回合结束保留手牌", () => {
  it("手牌不进弃牌堆", () => {
    const s = combat("runic_pyramid");
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    endTurn(s);
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "strike")).toBe(false);
  });
});
