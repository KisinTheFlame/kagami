import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import {
  pickNormalEncounter,
  pickEliteEncounter,
  pickBossEncounter,
} from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import { TOTAL_ACTS } from "../src/engine/run/run.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// B3：第三幕（超越）切片——3 普通 + 蛇法师 + 铎努与迪卡。

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 9999;
  s.maxHp = 9999;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("三幕", () => {
  it("TOTAL_ACTS = 3", () => {
    expect(TOTAL_ACTS).toBe(3);
  });

  it("act=3 池只出第三幕内容", () => {
    const ACT3_NORMALS = new Set([
      "spiker",
      "orb_walker",
      "exploder",
      "two_exploders",
      "repulsor",
      "transient",
      "two_orb_walkers",
      "three_shapes",
      "four_shapes",
      "sphere_and_two_shapes",
      "jaw_worm_horde",
    ]);
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = seedRng(seed);
      for (const entered of [0, 2, 5]) {
        expect(ACT3_NORMALS.has(pickNormalEncounter(rng, entered, 3))).toBe(true);
      }
    }
    const ACT3_ELITES = new Set(["reptomancer", "giant_head", "nemesis"]);
    const ACT3_BOSSES = new Set(["donu_deca", "awakened_one", "time_eater"]);
    for (let seed = 0; seed < 40; seed += 1) {
      expect(ACT3_ELITES.has(pickEliteEncounter(seedRng(seed), 3))).toBe(true);
      expect(ACT3_BOSSES.has(pickBossEncounter(seedRng(seed), 3))).toBe(true);
    }
  });
});

describe("爆破怪：亡语爆炸", () => {
  it("被杀死时对玩家造成 30 伤害", () => {
    const s = fight("two_exploders"); // 双爆破怪：杀一只战斗不结束，便于观察
    s.hp = 100;
    s.combat!.enemies[0]!.hp = 1;
    play(s, "strike", 0); // 打死 0 号
    expect(s.combat!.enemies[0]!.hp).toBe(0);
    expect(s.hp).toBe(70); // 亡语爆炸 30
  });
});

describe("尖刺客：反甲", () => {
  it("开局自带 3 反甲，攻击它反弹 3", () => {
    const s = fight("spiker");
    expect(getPower(s.combat!.enemies[0]!.powers, "sharp_hide")).toBe(3);
    s.hp = 100;
    s.combat!.enemies[0]!.hp = 50;
    play(s, "strike", 0); // 打它 → 反弹 3
    expect(s.hp).toBe(97);
  });
});

describe("蛇法师：召唤匕首", () => {
  it("首招召唤两把匕首", () => {
    const s = fight("reptomancer");
    expect(s.combat!.enemies[0]!.currentMove).toBe("summon_daggers");
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies.filter(e => e.defId === "dagger")).toHaveLength(2);
  });
});

describe("铎努与迪卡：双子 Boss", () => {
  it("两只登场；铎努赋能给双方 +3 力量", () => {
    const s = fight("donu_deca");
    expect(s.combat!.enemies.map(e => e.defId)).toEqual(["deca", "donu"]);
    const donu = s.combat!.enemies.find(e => e.defId === "donu")!;
    donu.currentMove = "donu_power";
    s.combat!.enemies.find(e => e.defId === "deca")!.currentMove = "deca_protect";
    s.combat!.hand = [];
    endTurn(s);
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "strength")).toBeGreaterThanOrEqual(3);
    }
  });
});
