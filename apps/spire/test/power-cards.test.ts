import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M3f：玩家能力牌——金属化(回合末格挡引擎)/恶魔形态(回合始力量成长) + 鲁莽冲锋。

function combat(): GameState {
  const s = newRun({ runId: "pc", seed: 1 });
  startCombat(s, "cultist");
  s.hp = 500;
  s.maxHp = 500;
  s.combat!.enemies[0]!.hp = 500;
  s.combat!.enemies[0]!.maxHp = 500;
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("金属化：回合结束加格挡", () => {
  it("回合末获得 3 格挡，吸收敌人攻击（暗袭6 → 只掉 3）", () => {
    const s = combat();
    play(s, "metallicize");
    expect(getPower(s.combat!.playerPowers, "metallicize")).toBe(3);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 邪教徒暗袭 6
    endTurn(s);
    expect(s.hp).toBe(500 - 3); // 6 伤 - 3 金属化格挡
  });

  it("金属化格挡是定值、不受脆弱影响", () => {
    const s = combat();
    play(s, "metallicize");
    s.combat!.hand = [];
    s.combat!.playerPowers.push({ id: "frail", amount: 3 });
    s.combat!.enemies[0]!.currentMove = "dark_strike";
    endTurn(s);
    // 脆弱若错误地作用于金属化会变成 floor(3×0.75)=2 → 掉 4；定值应仍给 3 → 掉 3。
    expect(s.hp).toBe(500 - 3);
  });
});

describe("恶魔形态：回合开始加力量", () => {
  it("打出后每回合开始 +2 力量（当回合不触发，下回合起）", () => {
    const s = combat();
    play(s, "demon_form");
    expect(getPower(s.combat!.playerPowers, "demon_form")).toBe(2);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(0); // 当回合还没加
    s.combat!.hand = [];
    endTurn(s); // 进入下一回合 → +2 力量
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
    s.combat!.hand = [];
    endTurn(s); // 再下一回合 → 累计 +2
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(4);
  });

  it("升级版每回合 +3", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "demon_form", upgraded: true };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    s.combat!.hand = [];
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(3);
  });
});

describe("鲁莽冲锋", () => {
  it("造成 7 并把一张眩晕洗入抽牌堆", () => {
    const s = combat();
    const before = s.combat!.drawPile.length;
    play(s, "reckless_charge", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(500 - 7);
    expect(s.combat!.drawPile.filter(c => c.defId === "dazed")).toHaveLength(1);
    expect(s.combat!.drawPile.length).toBe(before + 1);
  });

  it("升级造成 10", () => {
    const s = combat();
    const c: CardInstance = { uid: s.nextUid++, defId: "reckless_charge", upgraded: true };
    s.combat!.hand = [c];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(500 - 10);
  });
});
