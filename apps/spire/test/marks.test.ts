import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 敌人标记：靶心（锁定→闪电/暗球增伤）/ 扼喉（每出牌掉血，回合末清）。

function combat(character: "silent" | "defect"): GameState {
  const s = newRun({ runId: "mk", seed: 43, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  if (character === "defect") {
    s.combat!.orbs = [];
    s.combat!.orbSlots = 10;
  }
  return s;
}

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("靶心：锁定放大闪电球伤害", () => {
  it("锁定后闪电球唤醒伤害 ×1.5", () => {
    const s = combat("defect");
    play(s, "bullseye", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "lock_on")).toBe(2);
    // 手动放一颗闪电球并唤醒（唤醒 = 8 基础）；锁定使其 ×1.5 = 12。
    s.combat!.orbs = [{ type: "lightning" }];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "dualcast", null); // 双重施法：唤醒最左侧球两次（此处只有一颗）
    // 至少造成一次带锁定加成的闪电伤害（12 而非 8）。
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(12);
  });
});

describe("扼喉：每出牌掉血，回合末清除", () => {
  it("挂上扼喉后每打一张牌目标掉 3", () => {
    const s = combat("silent");
    play(s, "choke", 0); // 造成 12 + 挂扼喉 3
    const afterChoke = s.combat!.enemies[0]!.hp;
    expect(getPower(s.combat!.enemies[0]!.powers, "choked")).toBe(3);
    // 再打一张牌 → 目标额外掉 3（无视格挡；先给敌人格挡验证无视）。
    s.combat!.enemies[0]!.block = 100;
    play(s, "defend", null);
    expect(s.combat!.enemies[0]!.hp).toBe(afterChoke - 3);
  });

  it("玩家回合结束清除扼喉", () => {
    const s = combat("silent");
    play(s, "choke", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "choked")).toBe(3);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(getPower(s.combat!.enemies[0]!.powers, "choked")).toBe(0);
  });
});
