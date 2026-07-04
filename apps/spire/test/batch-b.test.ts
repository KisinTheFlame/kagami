import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 狂暴 / 重启 / 涡轮。

function combat(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "bb", seed: 25, character });
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

describe("狂暴", () => {
  it("自身易伤 + 每回合始 +1 能量", () => {
    const s = combat();
    play(s, "berserk", null);
    expect(getPower(s.combat!.playerPowers, "vulnerable")).toBe(2);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.energy).toBe(s.combat!.maxEnergy + 1);
  });
});

describe("重启", () => {
  it("手牌+弃牌堆洗回抽牌堆，然后抽 4", () => {
    const s = combat("defect");
    s.combat!.discardPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    // 手牌 = reboot + 2 张其它。
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "reboot", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    s.combat!.drawPile = [];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 原弃牌堆的 5 张 strike 都洗回抽牌堆（reboot 自身随后进弃牌堆）。
    expect(s.combat!.discardPile.some(c => c.defId === "strike")).toBe(false);
    expect(s.combat!.hand).toHaveLength(4); // 抽 4
  });
});

describe("涡轮", () => {
  it("+2 能量 + 弃牌堆加眩晕", () => {
    const s = combat("defect");
    play(s, "turbo", null, 0);
    expect(s.combat!.energy).toBe(2);
    expect(s.combat!.discardPile.some(c => c.defId === "dazed")).toBe(true);
  });
});
