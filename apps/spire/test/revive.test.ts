import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { grantRelic } from "../src/engine/relics/relics.js";
import type { GameState } from "../src/engine/types.js";

function lethal(s: GameState) {
  // 敌人暗袭必致死：设玩家 1 血、无格挡，敌人攻击。
  s.hp = 1;
  s.combat!.playerBlock = 0;
  s.combat!.enemies[0]!.currentMove = "dark_strike";
  s.combat!.hand = [];
  endTurn(s);
}

describe("蜥蜴之尾：濒死回半血", () => {
  it("致死伤害后复活到半血、战斗继续", () => {
    const s = newRun({ runId: "lt", seed: 1, character: "ironclad" });
    grantRelic(s, "lizard_tail");
    startCombat(s, "cultist");
    s.maxHp = 80;
    lethal(s);
    expect(s.screen).not.toBe("gameover");
    expect(s.hp).toBe(40);
    expect(s.relics.find(r => r.id === "lizard_tail")!.counter).toBe(1);
  });
});

describe("瓶中仙灵：濒死消耗、回 30%", () => {
  it("致死后消耗药水复活", () => {
    const s = newRun({ runId: "fb", seed: 1, character: "ironclad" });
    startCombat(s, "cultist");
    s.maxHp = 100;
    s.potions[0] = "fairy_in_a_bottle";
    lethal(s);
    expect(s.screen).not.toBe("gameover");
    expect(s.hp).toBe(30);
    expect(s.potions[0]).toBeNull();
  });
});
