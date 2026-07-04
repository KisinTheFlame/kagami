import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 虐念（施减益即伤）/ 流水线（每打出降 1 费）。

function combat(character: "silent" | "defect"): GameState {
  const s = newRun({ runId: "ss", seed: 48, character });
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

describe("虐念：施加减益即造成伤害", () => {
  it("挂虐念后打出施虚弱的牌 → 目标额外掉 5", () => {
    const s = combat("silent");
    play(s, "sadistic_nature", null);
    expect(getPower(s.combat!.playerPowers, "sadistic_nature")).toBe(5);
    // 用「防御姿态」类施虚弱的牌；这里用 neutralize（中和：造成伤害并施虚弱）。
    s.combat!.enemies[0]!.block = 0;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "neutralize", 0); // 造成 3 + 施虚弱 → 虐念再 5
    // 至少包含中和自身伤害 + 虐念 5。
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(3 + 5);
    expect(getPower(s.combat!.enemies[0]!.powers, "weak")).toBeGreaterThan(0);
  });

  it("给自己上增益不触发虐念", () => {
    const s = combat("silent");
    play(s, "sadistic_nature", null);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "footwork", null); // 脚法：自身敏捷（非减益、非敌人）
    expect(s.combat!.enemies[0]!.hp).toBe(before);
  });
});

describe("流水线：每打出永久降 1 费", () => {
  it("同一实例连打三次，费用 2→1→0", () => {
    const s = combat("defect");
    const card: CardInstance = { uid: s.nextUid++, defId: "streamline", upgraded: false };
    // 第一次：费用 2。
    s.combat!.hand = [card];
    s.combat!.energy = 2;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
    expect(card.costReduction).toBe(1);
    // 第二次：费用 1。
    s.combat!.hand = [card];
    s.combat!.energy = 1;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
    // 第三次：费用 0。
    s.combat!.hand = [card];
    s.combat!.energy = 0;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(card.costReduction).toBe(3);
  });
});
