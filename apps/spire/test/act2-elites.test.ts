import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getEncounterDef, pickEliteEncounter } from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import type { GameState } from "../src/engine/types.js";

// B2 补齐：第二幕精英——地精首领(召唤)、奴隶主小队(工头)。

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 9999;
  s.maxHp = 9999;
  return s;
}

function leaderOf(s: GameState) {
  return s.combat!.enemies.find(e => e.defId === "gremlin_leader")!;
}

describe("地精首领：召唤", () => {
  it("身边地精 <2 只时下一招变召唤", () => {
    const s = fight("gremlin_leader");
    // 杀掉两只随从地精
    for (const e of s.combat!.enemies) {
      if (e.defId !== "gremlin_leader") {
        e.hp = 0;
      }
    }
    s.combat!.hand = [];
    endTurn(s); // 首领行动后重新 telegraph
    expect(leaderOf(s).currentMove).toBe("summon_gremlins");
  });

  it("召唤把两只地精加入战斗", () => {
    const s = fight("gremlin_leader");
    for (const e of s.combat!.enemies) {
      if (e.defId !== "gremlin_leader") {
        e.hp = 0;
      }
    }
    const before = s.combat!.enemies.length;
    leaderOf(s).currentMove = "summon_gremlins";
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies.length).toBe(before + 2);
  });

  it("召唤不超过场上 5 只上限", () => {
    const s = fight("gremlin_leader");
    // 已经 3 只；反复召唤，存活数不应超过 5
    for (let i = 0; i < 6; i += 1) {
      leaderOf(s).currentMove = "summon_gremlins";
      s.hp = 9999;
      s.combat!.hand = [];
      endTurn(s);
    }
    const living = s.combat!.enemies.filter(e => e.hp > 0 && !e.escaped).length;
    expect(living).toBeLessThanOrEqual(5);
  });

  it("鼓舞给所有敌人 +3 力量", () => {
    const s = fight("gremlin_leader");
    leaderOf(s).currentMove = "encourage";
    for (const e of s.combat!.enemies) {
      if (e.defId !== "gremlin_leader") {
        e.currentMove = "scratch"; // 随从随便动
      }
    }
    s.combat!.hand = [];
    endTurn(s);
    for (const e of s.combat!.enemies) {
      if (e.hp > 0) {
        expect(getPower(e.powers, "strength")).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("工头：抽打", () => {
  it("造成 7 伤并塞一张伤口进弃牌堆", () => {
    const s = fight("slavers");
    const taskmaster = s.combat!.enemies.find(e => e.defId === "taskmaster")!;
    s.hp = 100;
    // 让另外两个奴隶主不动
    for (const e of s.combat!.enemies) {
      if (e.defId !== "taskmaster") {
        e.hp = 0;
      }
    }
    const before = s.combat!.discardPile.filter(c => c.defId === "wound").length;
    s.combat!.hand = [];
    taskmaster.currentMove = "scouring_whip";
    endTurn(s);
    expect(s.hp).toBe(93);
    expect(s.combat!.discardPile.filter(c => c.defId === "wound").length).toBe(before + 1);
  });
});

describe("第二幕精英池", () => {
  it("奴隶主小队组成 = 工头 + 蓝奴 + 红奴", () => {
    expect(getEncounterDef("slavers").enemies).toEqual(["taskmaster", "blue_slaver", "red_slaver"]);
  });

  it("act=2 精英池含 穿刺之书/地精首领/奴隶主小队", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      seen.add(pickEliteEncounter(seedRng(seed), 2));
    }
    expect(seen.has("book_of_stabbing")).toBe(true);
    expect(seen.has("gremlin_leader")).toBe(true);
    expect(seen.has("slavers")).toBe(true);
  });
});
