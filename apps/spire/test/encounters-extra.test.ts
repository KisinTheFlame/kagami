import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat } from "../src/engine/combat/combat.js";

// PR3：新增的组合遭遇（既有敌人拼装）能正常起战、生成预期数量的敌人。

const CASES: [string, number][] = [
  ["cultist_and_chosen", 2],
  ["three_cultists", 3],
  ["shelled_parasite_and_fungi", 2],
  ["sentry_and_sphere", 3],
  ["three_shapes", 3],
  ["four_shapes", 4],
  ["sphere_and_two_shapes", 3],
  ["jaw_worm_horde", 3],
];

describe("新增组合遭遇：起战与敌人数量", () => {
  for (const [encounter, count] of CASES) {
    it(`${encounter} → ${count} 个敌人，均有正血量`, () => {
      const s = newRun({ runId: `enc-${encounter}`, seed: 1 });
      startCombat(s, encounter);
      expect(s.combat).not.toBeNull();
      expect(s.combat!.enemies).toHaveLength(count);
      for (const e of s.combat!.enemies) {
        expect(e.hp).toBeGreaterThan(0);
        expect(e.currentMove).toBeTruthy();
      }
    });
  }
});
