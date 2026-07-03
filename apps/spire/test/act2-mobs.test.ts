import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { pickNormalEncounter } from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import type { GameState } from "../src/engine/types.js";

// B2 补齐：第二幕普通怪（带壳寄生虫/选民/史尼克/秘法师）+ 敌人镀甲/自愈/治疗友军。

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 9999;
  s.maxHp = 9999;
  return s;
}

describe("带壳寄生虫：镀甲 + 吸取", () => {
  it("开局自带 14 镀甲，回合末获得等量格挡", () => {
    const s = fight("shelled_parasite");
    const p = s.combat!.enemies[0]!;
    expect(getPower(p.powers, "plated_armor")).toBe(14);
    s.combat!.hand = [];
    p.currentMove = "double_strike";
    endTurn(s);
    expect(p.block).toBe(14); // 回合末镀甲给 14 格挡
  });

  it("吸取造成 10 伤并自愈 10", () => {
    const s = fight("shelled_parasite");
    const p = s.combat!.enemies[0]!;
    p.hp = 40;
    p.maxHp = 72;
    s.hp = 100;
    s.combat!.hand = [];
    p.currentMove = "suck";
    endTurn(s);
    expect(s.hp).toBe(90); // 玩家 -10
    expect(p.hp).toBe(50); // 敌人 +10
  });
});

describe("选民：汲取", () => {
  it("首招汲取：给玩家 3 虚弱、自身 +3 力量", () => {
    const s = fight("chosen");
    const c = s.combat!.enemies[0]!;
    expect(c.currentMove).toBe("drain");
    s.combat!.hand = [];
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(3);
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(3);
  });
});

describe("史尼克：尾击削弱", () => {
  it("尾击造成 8 伤 + 2 虚弱", () => {
    const s = fight("snecko");
    s.hp = 100;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "tail_whip";
    endTurn(s);
    expect(s.hp).toBe(92);
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(2);
  });
});

describe("秘法师：治疗 + 鼓舞友军", () => {
  it("治疗受伤友军 16", () => {
    const s = fight("centurion_mystic");
    const cent = s.combat!.enemies.find(e => e.defId === "centurion")!;
    const mystic = s.combat!.enemies.find(e => e.defId === "mystic")!;
    cent.hp = 30;
    cent.maxHp = 80;
    s.combat!.hand = [];
    mystic.currentMove = "mystic_heal";
    endTurn(s);
    expect(s.combat!.enemies.find(e => e.defId === "centurion")!.hp).toBe(46); // +16
  });

  it("鼓舞给所有敌人（含自己）+2 力量", () => {
    const s = fight("centurion_mystic");
    const mystic = s.combat!.enemies.find(e => e.defId === "mystic")!;
    s.combat!.hand = [];
    mystic.currentMove = "mystic_buff";
    // 让百夫长不动
    s.combat!.enemies.find(e => e.defId === "centurion")!.currentMove = "cent_defend";
    endTurn(s);
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "strength")).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("第二幕池已含新怪", () => {
  it("act=2 普通池会抽到带壳寄生虫/选民/史尼克/秘法师组", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 120; seed += 1) {
      const rng = seedRng(seed);
      for (const entered of [0, 1, 2, 4, 6]) {
        seen.add(pickNormalEncounter(rng, entered, 2));
      }
    }
    expect(seen.has("shelled_parasite")).toBe(true);
    expect(seen.has("chosen")).toBe(true);
    expect(seen.has("snecko")).toBe(true);
    expect(seen.has("centurion_mystic")).toBe(true);
  });
});
