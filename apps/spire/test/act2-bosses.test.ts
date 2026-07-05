import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { pickBossEncounter } from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import type { GameState } from "../src/engine/types.js";

// B2 补齐：第二幕 Boss——青铜自动机(召唤球+超射线)、收藏家(召唤火把头+群体削弱)。

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 9999;
  s.maxHp = 9999;
  return s;
}

describe("第二幕 Boss 池", () => {
  it("含 冠军 / 青铜自动机 / 收藏家", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      seen.add(pickBossEncounter(seedRng(seed), 2));
    }
    expect(seen.has("champ")).toBe(true);
    expect(seen.has("bronze_automaton")).toBe(true);
    expect(seen.has("the_collector")).toBe(true);
  });
});

describe("青铜自动机", () => {
  it("首招召唤两颗青铜球", () => {
    const s = fight("bronze_automaton");
    expect(s.combat!.enemies[0]!.currentMove).toBe("spawn_orbs");
    s.combat!.hand = [];
    endTurn(s);
    const orbs = s.combat!.enemies.filter(e => e.defId === "bronze_orb");
    expect(orbs).toHaveLength(2);
  });

  it("超射线造成 45", () => {
    const s = fight("bronze_automaton");
    s.hp = 100;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "hyperbeam";
    endTurn(s);
    expect(s.hp).toBe(55);
  });
});

describe("收藏家", () => {
  it("首招召唤两个火把头", () => {
    const s = fight("the_collector");
    expect(s.combat!.enemies[0]!.currentMove).toBe("spawn_torches");
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies.filter(e => e.defId === "torch_head")).toHaveLength(2);
  });

  it("巨型削弱给玩家 3 虚弱 + 3 易伤 + 3 脆弱", () => {
    const s = fight("the_collector");
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "mega_debuff";
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(3);
    expect(getPower(s.combat!.playerPowers, "vulnerable")).toBe(3);
    expect(getPower(s.combat!.playerPowers, "frail")).toBe(3);
  });
});

describe("击败第二幕 Boss 掉金币 ~100", () => {
  it("秒杀青铜自动机得 95-105 金", () => {
    const s = fight("bronze_automaton");
    s.gold = 0;
    s.combat!.enemies[0]!.hp = 1;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "bludgeon", upgraded: false }];
    s.combat!.energy = 9;
    playCard(s, 0, 0);
    expect(s.screen).toBe("victory");
    // 首领金币掉落固定 95-105；首领遗物奖励可能另加金币（如小屋 +50），故按掉落日志校验。
    const dropped = Number(s.log.find(l => l.includes("击败首领，获得"))?.match(/(\d+)/)?.[1]);
    expect(dropped).toBeGreaterThanOrEqual(95);
    expect(dropped).toBeLessThanOrEqual(105);
  });
});
