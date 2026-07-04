import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 命中触发：以手言心（标记→攻击时得格挡）/ 淬毒（穿透→中毒）。

function combat(character: "watcher" | "silent"): GameState {
  const s = newRun({ runId: "oh", seed: 46, character });
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

describe("以手言心：标记后攻击得格挡", () => {
  it("标记 2 后，普通打击使玩家获得 2 格挡", () => {
    const s = combat("watcher");
    s.combat!.playerBlock = 0;
    play(s, "talk_to_the_hand", 0); // 造成 5 + 标记 2（自身也命中一次 → +2 格挡）
    expect(getPower(s.combat!.enemies[0]!.powers, "mark")).toBe(2);
    // 以手言心自身命中已给 +2；再打一次 strike → 再 +2。
    const blockBefore = s.combat!.playerBlock;
    play(s, "strike", 0);
    expect(s.combat!.playerBlock).toBe(blockBefore + 2);
  });
});

describe("淬毒：穿透格挡的攻击施加中毒", () => {
  it("挂淬毒后打穿格挡 → 目标中毒 1", () => {
    const s = combat("silent");
    play(s, "envenom", null);
    expect(getPower(s.combat!.playerPowers, "envenom")).toBe(1);
    s.combat!.enemies[0]!.block = 0;
    play(s, "strike", 0); // 6 穿透 → 中毒 1
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBe(1);
  });

  it("被完全格挡时不施加中毒", () => {
    const s = combat("silent");
    play(s, "envenom", null);
    s.combat!.enemies[0]!.block = 100; // 完全挡住 strike
    play(s, "strike", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBe(0);
  });

  it("多段攻击每段穿透各施加一次中毒", () => {
    const s = combat("silent");
    play(s, "envenom", null);
    s.combat!.enemies[0]!.block = 0;
    play(s, "twin_strike", 0); // 双重打击：两段 → 中毒 2
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBe(2);
  });
});
