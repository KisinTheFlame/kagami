import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 阿尔法→贝塔→奥米加 链条 + 奥米加回合末 50 全体伤害。

function combat(): GameState {
  const s = newRun({ runId: "abo", seed: 50, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function findIn(g: GameState, defId: string): number {
  return [g.combat!.hand, g.combat!.drawPile, g.combat!.discardPile]
    .flat()
    .filter(c => c.defId === defId).length;
}

describe("阿尔法链条：逐级洗入下一张", () => {
  it("阿尔法洗入贝塔，贝塔洗入奥米加", () => {
    const s = combat();
    s.combat!.drawPile = [];
    s.combat!.hand = [{ uid: s.nextUid++, defId: "alpha", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(findIn(s, "beta")).toBe(1);
    expect(s.combat!.exhaustPile.some(c => c.defId === "alpha")).toBe(true);
    // 打出贝塔 → 洗入奥米加。
    const beta = s.combat!.drawPile.find(c => c.defId === "beta")!;
    s.combat!.hand = [beta];
    s.combat!.drawPile = s.combat!.drawPile.filter(c => c.defId !== "beta");
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(findIn(s, "omega")).toBe(1);
  });
});

describe("奥米加：回合末对全体 50 伤害", () => {
  it("挂奥米加后回合结束敌人受 50", () => {
    const s = combat();
    const omega: CardInstance = { uid: s.nextUid++, defId: "omega", upgraded: false };
    s.combat!.hand = [omega];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "omega")).toBe(1);
    const before = s.combat!.enemies[0]!.hp;
    s.combat!.enemies[0]!.block = 0;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 回合末 50 全体伤害（敌人 300 血，不会死）。
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(50);
  });
});
