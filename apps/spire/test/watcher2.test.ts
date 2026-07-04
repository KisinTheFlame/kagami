import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 观者能力牌：提婆形态 / 烈焰花环（活力）/ 招牌动作。

function combat(): GameState {
  const s = newRun({ runId: "w2", seed: 30, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("提婆形态：能量逐回合递增", () => {
  it("每回合开始能量增长，层数 +1", () => {
    const s = combat();
    play(s, "deva_form", null);
    expect(getPower(s.combat!.playerPowers, "deva_form")).toBe(1);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 回合开始 +1 能量（提婆 1），层数变 2。
    expect(s.combat!.energy).toBe(s.combat!.maxEnergy + 1);
    expect(getPower(s.combat!.playerPowers, "deva_form")).toBe(2);
  });
});

describe("烈焰花环：活力加持下一张攻击", () => {
  it("下一张攻击 +5，随后活力清零", () => {
    const s = combat();
    play(s, "wreath_of_flame", null);
    expect(getPower(s.combat!.playerPowers, "vigor")).toBe(5);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0); // 6 + 5 = 11
    expect(s.combat!.enemies[0]!.hp).toBe(before - 11);
    expect(getPower(s.combat!.playerPowers, "vigor")).toBe(0);
    // 再打一张攻击不再有活力加成。
    const before2 = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before2 - 6);
  });
});

describe("招牌动作：手牌全攻击才发挥", () => {
  it("其余手牌全为攻击 → 造成 30", () => {
    const s = combat();
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "signature_move", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 30);
  });

  it("手牌含技能 → 不造成伤害", () => {
    const s = combat();
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "signature_move", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before);
  });
});
