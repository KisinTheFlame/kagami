import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 出牌计数：超光速（≤N 张则抽牌）/ 华彩（每 5 张对全体伤害）。cardsPlayedThisTurn。

function combat(character: "defect" | "watcher"): GameState {
  const s = newRun({ runId: "cc", seed: 40, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  if (character === "defect") s.combat!.orbs = [];
  return s;
}

function playOne(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("超光速：出牌数≤3 才抽", () => {
  it("作为本回合第 1 张 → 抽 1", () => {
    const s = combat("defect");
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    playOne(s, "ftl", 0);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(1);
  });

  it("已打出 3 张后 → 第 4 张超光速不抽", () => {
    const s = combat("defect");
    s.combat!.cardsPlayedThisTurn = 3; // 已出 3 张；超光速为第 4 张。
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    playOne(s, "ftl", 0);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(0);
  });
});

describe("华彩：每 5 张对全体造成伤害", () => {
  it("打满第 5 张时触发 10 点全体伤害", () => {
    const s = combat("watcher");
    // 先挂上华彩能力（本身算 1 张）。
    playOne(s, "panache", null);
    expect(getPower(s.combat!.playerPowers, "panache")).toBe(10);
    expect(s.combat!.cardsPlayedThisTurn).toBe(1);
    const before = s.combat!.enemies[0]!.hp;
    // 再打 4 张（凑满 5）；前 3 张不触发，第 5 张（cardsPlayed=5）触发。
    playOne(s, "strike", 0); // 2
    playOne(s, "strike", 0); // 3
    playOne(s, "strike", 0); // 4
    const beforeFifth = s.combat!.enemies[0]!.hp;
    playOne(s, "defend", null); // 5 张 → 华彩触发 10（defend 不打伤害）
    // 第 5 张是 defend（0 伤），敌人只掉华彩的 10。
    expect(s.combat!.enemies[0]!.hp).toBe(beforeFifth - 10);
    void before;
  });
});
