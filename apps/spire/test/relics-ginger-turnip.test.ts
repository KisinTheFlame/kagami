import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { grantRelic } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";

// 姜/萝卜：免疫虚弱/脆弱（敌人施加时被拦截）。
function setup(relic: string) {
  const s = newRun({ runId: relic, seed: 1, character: "ironclad" });
  grantRelic(s, relic);
  startCombat(s, "the_maw"); // 首招咆哮：虚弱3 + 脆弱3
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.currentMove = "maw_roar";
  s.combat!.hand = [];
  endTurn(s);
  return s;
}

describe("姜：免疫虚弱", () => {
  it("巨口咆哮后无虚弱、仍吃脆弱", () => {
    const s = setup("ginger");
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(0);
    expect(getPower(s.combat!.playerPowers, "frail")).toBe(3);
  });
});
describe("萝卜：免疫脆弱", () => {
  it("巨口咆哮后无脆弱、仍吃虚弱", () => {
    const s = setup("turnip");
    expect(getPower(s.combat!.playerPowers, "frail")).toBe(0);
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(3);
  });
});
