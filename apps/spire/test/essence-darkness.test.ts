import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";

// 暗影精华（机器人）：每个球槽充能一颗暗球。
describe("暗影精华", () => {
  it("3 球槽 → 充能 3 颗暗球", () => {
    const s = newRun({ runId: "eod", seed: 1, character: "defect" });
    startCombat(s, "cultist");
    s.combat!.orbs = [];
    s.combat!.orbSlots = 3;
    s.potions[0] = "essence_of_darkness";
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.orbs.filter(o => o.type === "dark")).toHaveLength(3);
  });
});
