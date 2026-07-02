import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getEncounterDef } from "../src/engine/enemies/enemies.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M3c-1：真菌兽 + 亡语（孢子云死亡给玩家易伤）+ on-death 钩子。asc0。

function fungiFight(): GameState {
  const s = newRun({ runId: "fungi", seed: 1 });
  startCombat(s, "two_fungi_beasts");
  s.hp = 500;
  s.maxHp = 500;
  return s;
}

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("真菌兽：孢子云亡语", () => {
  it("HP 22-28，开局自带孢子云 2", () => {
    const s = fungiFight();
    for (const e of s.combat!.enemies) {
      expect(e.hp).toBeGreaterThanOrEqual(22);
      expect(e.hp).toBeLessThanOrEqual(28);
      expect(getPower(e.powers, "spore_cloud")).toBe(2);
    }
  });

  it("杀死真菌兽 → 玩家被施加 2 层易伤", () => {
    const s = fungiFight();
    s.combat!.enemies[0]!.hp = 5;
    play(s, "bludgeon", 0); // 32 伤，杀死 0 号
    expect(s.combat!.enemies[0]!.hp).toBe(0);
    expect(getPower(s.combat!.playerPowers, "vulnerable")).toBe(2);
  });

  it("亡语只在致死时触发一次（多段攻击不叠加）", () => {
    const s = fungiFight();
    s.combat!.enemies[0]!.hp = 3;
    play(s, "pummel", 0); // 2×4 多段，第 2 段致死，后续段不再触发亡语
    expect(s.combat!.enemies[0]!.hp).toBe(0);
    expect(getPower(s.combat!.playerPowers, "vulnerable")).toBe(2); // 仍是 2，不是 4/6/8
  });

  it("未致死不触发亡语", () => {
    const s = fungiFight();
    play(s, "strike", 0); // 6 伤，真菌兽 22+ 不死
    expect(getPower(s.combat!.playerPowers, "vulnerable")).toBe(0);
  });
});

describe("真菌兽组进 strong 池", () => {
  it("双真菌兽 encounter 组成正确", () => {
    expect(getEncounterDef("two_fungi_beasts").enemies).toEqual(["fungi_beast", "fungi_beast"]);
  });
});
