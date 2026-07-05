import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { grantRelic } from "../src/engine/relics/relics.js";

// onEquip 一次性遗物。
describe("onEquip 遗物", () => {
  it("古钱币：+300 金币", () => {
    const s = newRun({ runId: "oc", seed: 1, character: "ironclad" });
    const g = s.gold;
    grantRelic(s, "old_coin");
    expect(s.gold).toBe(g + 300);
  });
  it("芒果：+14 最大生命", () => {
    const s = newRun({ runId: "mg", seed: 1, character: "ironclad" });
    const m = s.maxHp;
    grantRelic(s, "mango");
    expect(s.maxHp).toBe(m + 14);
  });
  it("李的松饼：+7 最大生命并回满", () => {
    const s = newRun({ runId: "lw", seed: 1, character: "ironclad" });
    s.hp = 10;
    const m = s.maxHp;
    grantRelic(s, "lees_waffle");
    expect(s.maxHp).toBe(m + 7);
    expect(s.hp).toBe(m + 7);
  });
});
