import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 终局（AoE + 结束回合）/ 连绵拳（切换姿态从弃牌堆收回）。

function combat(): GameState {
  const s = newRun({ runId: "s2", seed: 52, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("终局：AoE 后立即结束回合", () => {
  it("造成全体伤害并推进到下一回合", () => {
    const s = combat();
    s.combat!.enemies[0]!.block = 0;
    const before = s.combat!.enemies[0]!.hp;
    const turnBefore = s.combat!.turn;
    const card: CardInstance = { uid: s.nextUid++, defId: "conclude", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    s.combat!.enemies[0]!.currentMove = "incantation";
    expect(playCard(s, 0, null).ok).toBe(true);
    // 全体 12 伤害。
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(12);
    // 回合已推进（结束回合触发了敌人回合 + 新回合）。
    expect(s.combat!.turn).toBe(turnBefore + 1);
  });
});

describe("连绵拳：切换姿态从弃牌堆收回", () => {
  it("打出进弃牌堆，进入愤怒后收回手牌", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "flurry_of_blows", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 0 费攻击进弃牌堆。
    expect(s.combat!.discardPile.some(c => c.defId === "flurry_of_blows")).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "flurry_of_blows")).toBe(false);
    // 打出「喷发」进入愤怒姿态 → 连绵拳被收回手牌。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "eruption", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.playerStance).toBe("wrath");
    expect(s.combat!.hand.some(c => c.defId === "flurry_of_blows")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "flurry_of_blows")).toBe(false);
  });
});
