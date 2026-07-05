import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat } from "../src/engine/combat/combat.js";
import { grantRelic } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getCardDef } from "../src/engine/cards/cards.js";

describe("红骷髅：半血以下开局 +3 力量", () => {
  it("开局半血 → +3 力量", () => {
    const s = newRun({ runId: "rs", seed: 1, character: "ironclad" });
    grantRelic(s, "red_skull");
    s.hp = Math.floor(s.maxHp / 2);
    startCombat(s, "cultist");
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(3);
  });
  it("满血 → 无力量", () => {
    const s = newRun({ runId: "rs2", seed: 1, character: "ironclad" });
    grantRelic(s, "red_skull");
    startCombat(s, "cultist");
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(0);
  });
});
describe("工具箱：开局加一张无色牌", () => {
  it("手牌含无色牌", () => {
    const s = newRun({ runId: "tb", seed: 1, character: "ironclad" });
    grantRelic(s, "toolbox");
    startCombat(s, "cultist");
    expect(s.combat!.hand.some(c => getCardDef(c.defId).color === "colorless")).toBe(true);
  });
});
