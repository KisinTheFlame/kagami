import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { grantRelic } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { GameState } from "../src/engine/types.js";

function combat(relic: string, character = "ironclad"): GameState {
  const s = newRun({ runId: relic, seed: 1, character: character as GameState["character"] });
  grantRelic(s, relic);
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("梨：+10 最大生命", () => {
  it("获得时 maxHp +10", () => {
    const s = newRun({ runId: "pear", seed: 1, character: "ironclad" });
    const m = s.maxHp;
    grantRelic(s, "pear");
    expect(s.maxHp).toBe(m + 10);
  });
});

describe("冠军腰带：施加易伤时也施加虚弱", () => {
  it("恐惧药水施加易伤 → 敌人也得虚弱", () => {
    const s = combat("champion_belt");
    s.potions[0] = "fear_potion";
    expect(usePotion(s, 0, 0).ok).toBe(true);
    const e = s.combat!.enemies[0]!;
    expect(getPower(e.powers, "vulnerable")).toBe(3);
    expect(getPower(e.powers, "weak")).toBe(1);
  });
});

describe("神圣树皮：药水效果翻倍", () => {
  it("格挡药水 12 → 24", () => {
    const s = combat("sacred_bark");
    s.combat!.playerBlock = 0;
    s.potions[0] = "block_potion";
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(24);
  });
});

describe("战斗开始类", () => {
  it("地精面容：开局自带 1 虚弱", () => {
    const s = combat("gremlin_visage");
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(1);
  });
  it("诱变力量：开局 +3 力量", () => {
    const s = combat("mutagenic_strength");
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(3);
  });
});
