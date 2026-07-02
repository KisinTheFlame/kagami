import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { addPower, getPower } from "../src/engine/powers/powers.js";
import { getEncounterDef, pickNormalEncounter } from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M2b：脆弱 debuff + Act1 weak/strong encounter 池节奏 + 新普通敌人组成。

function combat(): GameState {
  const state = newRun({ runId: "m2b", seed: 1 });
  startCombat(state, "cultist");
  state.hp = 200;
  state.maxHp = 200;
  return state;
}

function playDefend(state: GameState): void {
  const card: CardInstance = { uid: state.nextUid++, defId: "defend", upgraded: false };
  state.combat!.hand = [card];
  state.combat!.energy = 3;
  const r = playCard(state, 0, null);
  expect(r.ok).toBe(true);
}

describe("脆弱：格挡打七五折", () => {
  it("脆弱下防御 5 → 获得 3 格挡（floor(5×0.75)）", () => {
    const s = combat();
    addPower(s.combat!.playerPowers, "frail", 1);
    playDefend(s);
    expect(s.combat!.playerBlock).toBe(3);
  });

  it("无脆弱时防御正常给 5", () => {
    const s = combat();
    playDefend(s);
    expect(s.combat!.playerBlock).toBe(5);
  });

  it("脆弱每回合末 -1", () => {
    const s = combat();
    addPower(s.combat!.playerPowers, "frail", 2);
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "frail")).toBe(1);
  });
});

describe("Act1 战斗池节奏：前 3 场 weak、其余 strong", () => {
  // weak 的 small_slimes 被展开成 _a / _b。
  const WEAK = new Set(["cultist", "jaw_worm", "two_louse", "small_slimes_a", "small_slimes_b"]);
  const STRONG = new Set([
    "blue_slaver",
    "three_louse",
    "lots_of_slimes",
    "large_slime_acid",
    "large_slime_spike",
    "two_fungi_beasts",
  ]);

  it("combatsEntered < 3 只抽 weak 池", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = seedRng(seed);
      for (const entered of [0, 1, 2]) {
        expect(WEAK.has(pickNormalEncounter(rng, entered))).toBe(true);
      }
    }
  });

  it("combatsEntered >= 3 只抽 strong 池", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = seedRng(seed);
      for (const entered of [3, 5, 9]) {
        expect(STRONG.has(pickNormalEncounter(rng, entered))).toBe(true);
      }
    }
  });

  it("weak 池最终能抽出小史莱姆两种组成", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      seen.add(pickNormalEncounter(seedRng(seed), 0));
    }
    expect(seen.has("small_slimes_a")).toBe(true);
    expect(seen.has("small_slimes_b")).toBe(true);
  });
});

describe("新敌人组成 + 血量区间", () => {
  it("小史莱姆组两种组成（尖刺S+酸液M / 酸液S+尖刺M）", () => {
    expect(getEncounterDef("small_slimes_a").enemies).toEqual(["spike_slime_s", "acid_slime_m"]);
    expect(getEncounterDef("small_slimes_b").enemies).toEqual(["acid_slime_s", "spike_slime_m"]);
  });

  it("大量史莱姆 = 3 尖刺S + 2 酸液S", () => {
    expect(getEncounterDef("lots_of_slimes").enemies).toEqual([
      "spike_slime_s",
      "spike_slime_s",
      "spike_slime_s",
      "acid_slime_s",
      "acid_slime_s",
    ]);
  });

  it("蓝色奴隶主血量落在 46-50", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const s = newRun({ runId: `bs${seed}`, seed });
      startCombat(s, "blue_slaver");
      const hp = s.combat!.enemies[0]!.hp;
      expect(hp).toBeGreaterThanOrEqual(46);
      expect(hp).toBeLessThanOrEqual(50);
    }
  });

  it("小史莱姆组 _b 装载尖刺(中)+酸液(小) 两只不炸", () => {
    const s = newRun({ runId: "ss", seed: 1 });
    startCombat(s, "small_slimes_b");
    expect(s.combat!.enemies.map(e => e.defId)).toEqual(["acid_slime_s", "spike_slime_m"]);
  });
});
