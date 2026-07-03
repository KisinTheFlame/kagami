import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import {
  pickNormalEncounter,
  pickEliteEncounter,
  pickBossEncounter,
} from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import { TOTAL_ACTS } from "../src/engine/run/run.js";
import type { GameState } from "../src/engine/types.js";

// B2：第二幕（城市）切片——act-aware 池 + 3 普通 + 穿刺之书 + 冠军。

describe("多幕", () => {
  it("TOTAL_ACTS = 2（第二幕已有内容）", () => {
    expect(TOTAL_ACTS).toBe(2);
  });
});

describe("第二幕战斗池", () => {
  const ACT2_NORMALS = new Set(["spheric_guardian", "snake_plant", "centurion", "two_centurions"]);

  it("act=2 普通池只出第二幕怪", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = seedRng(seed);
      for (const entered of [0, 2, 5]) {
        expect(ACT2_NORMALS.has(pickNormalEncounter(rng, entered, 2))).toBe(true);
      }
    }
  });

  it("act=2 精英是穿刺之书、Boss 是冠军", () => {
    expect(pickEliteEncounter(seedRng(1), 2)).toBe("book_of_stabbing");
    expect(pickBossEncounter(seedRng(1), 2)).toBe("champ");
  });

  it("act=1 仍是第一幕内容", () => {
    const bosses = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      bosses.add(pickBossEncounter(seedRng(seed), 1));
    }
    expect([...bosses].every(b => ["guardian", "hexaghost", "slime_boss"].includes(b))).toBe(true);
  });
});

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 9999;
  s.maxHp = 9999;
  return s;
}

describe("球形守卫：3 层神器", () => {
  it("开局自带 3 层神器", () => {
    const s = fight("spheric_guardian");
    expect(getPower(s.combat!.enemies[0]!.powers, "artifact")).toBe(3);
    expect(s.combat!.enemies[0]!.currentMove).toBe("sg_activate"); // 首招激活
  });
});

describe("冠军：半血暴怒", () => {
  it("血量降到 ≤半血时暴怒一次（+6 力量），不重复", () => {
    const s = fight("champ");
    const champ = s.combat!.enemies[0]!;
    champ.maxHp = 400;
    champ.hp = 190; // ≤半血
    s.combat!.hand = [];
    endTurn(s); // selectNextMove 应先给暴怒
    // 暴怒在上一回合末 telegraph；这里 champ 已执行暴怒或已 telegraph
    // 通过多回合确认力量增加且暴怒只出现一次
    let angerCount = champ.moveHistory.filter(m => m === "anger").length;
    for (let i = 0; i < 20; i += 1) {
      s.hp = 9999;
      s.combat!.hand = [];
      endTurn(s);
    }
    angerCount = s.combat!.enemies[0]!.moveHistory.filter(m => m === "anger").length;
    expect(angerCount).toBe(1);
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBeGreaterThanOrEqual(6);
  });

  it("满血不暴怒", () => {
    const s = fight("champ");
    s.combat!.enemies[0]!.hp = s.combat!.enemies[0]!.maxHp;
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies[0]!.moveHistory.includes("anger")).toBe(false);
  });
});
