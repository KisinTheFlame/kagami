import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { getEnemyDef } from "../src/engine/enemies/enemies.js";
import type { GameState } from "../src/engine/types.js";

// 补全敌人 + 遭遇：起战、生成正确数量、HP 对齐 asc0。

const ENEMY_HP: Record<string, [number, number]> = {
  byrd: [25, 31],
  mugger: [48, 52],
  darkling: [48, 56],
  spire_growth: [170, 170],
  the_maw: [300, 300],
  writhing_mass: [160, 160],
};

describe("新敌人：HP 对齐 sts_lightspeed asc0", () => {
  for (const [id, [lo, hi]] of Object.entries(ENEMY_HP)) {
    it(`${id} HP ${lo}-${hi}`, () => {
      const def = getEnemyDef(id);
      expect(def.hpMin).toBe(lo);
      expect(def.hpMax).toBe(hi);
    });
  }
});

const ENCOUNTERS: [string, number][] = [
  ["three_byrds", 3],
  ["chosen_and_byrds", 3],
  ["two_thieves", 2],
  ["three_darklings", 3],
  ["spire_growth", 1],
  ["the_maw", 1],
  ["writhing_mass", 1],
];

describe("新遭遇：起战与敌人数量", () => {
  for (const [enc, count] of ENCOUNTERS) {
    it(`${enc} → ${count} 敌人，均有正血量与已 telegraph 意图`, () => {
      const s: GameState = newRun({ runId: `ne-${enc}`, seed: 2 });
      startCombat(s, enc);
      expect(s.combat!.enemies).toHaveLength(count);
      for (const e of s.combat!.enemies) {
        expect(e.hp).toBeGreaterThan(0);
        expect(e.currentMove).toBeTruthy();
      }
    });
  }
});

describe("巨口：首招咆哮施加虚弱+脆弱", () => {
  it("被咆哮后玩家吃虚弱与脆弱", () => {
    const s = newRun({ runId: "maw", seed: 1, character: "ironclad" });
    startCombat(s, "the_maw");
    s.hp = 300;
    s.maxHp = 300;
    s.combat!.enemies[0]!.currentMove = "maw_roar";
    s.combat!.hand = [];
    endTurn(s);
    const weak = s.combat!.playerPowers.find(p => p.id === "weak");
    const frail = s.combat!.playerPowers.find(p => p.id === "frail");
    expect(weak?.amount).toBe(3);
    expect(frail?.amount).toBe(3);
  });
});
