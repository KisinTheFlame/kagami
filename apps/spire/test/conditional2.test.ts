import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 飞踢（易伤则回能量+抽牌）/ 黑暗枷锁（临时削力，行动后归还）。

function combat(character: "ironclad"): GameState {
  const s = newRun({ runId: "c2", seed: 47, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("飞踢：目标易伤时回能量并抽牌", () => {
  it("目标易伤 → +1 能量、抽 1", () => {
    const s = combat("ironclad");
    s.combat!.enemies[0]!.powers = [{ id: "vulnerable", amount: 2 }];
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    const card: CardInstance = { uid: s.nextUid++, defId: "dropkick", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 花 1 费 + 易伤回 1 → 能量净不变（3）。
    expect(s.combat!.energy).toBe(3);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(1);
  });

  it("目标不易伤 → 无额外收益", () => {
    const s = combat("ironclad");
    s.combat!.enemies[0]!.powers = [];
    const card: CardInstance = { uid: s.nextUid++, defId: "dropkick", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(2); // 只花 1 费。
  });
});

describe("黑暗枷锁：临时削力，敌人行动后归还", () => {
  it("削 9 力量并记入枷锁；新回合归还", () => {
    const s = combat("ironclad");
    s.combat!.enemies[0]!.powers = [{ id: "strength", amount: 5 }];
    play(s, "dark_shackles", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(-4); // 5 - 9
    expect(getPower(s.combat!.enemies[0]!.powers, "shackled")).toBe(9);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 敌人本回合以被削状态行动
    endTurn(s);
    // 新回合开始：力量归还，枷锁清除。
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(5);
    expect(getPower(s.combat!.enemies[0]!.powers, "shackled")).toBe(0);
  });
});
