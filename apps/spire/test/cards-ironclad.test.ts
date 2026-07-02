import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { addPower, getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, EnemyState, GameState } from "../src/engine/types.js";

// M2a 铁甲战士扩充卡池：数值对齐 sts_lightspeed（asc0）。
// 每个用例把目标卡强塞进手牌单独打出，隔离验证其效果与新原语。

function combat(seed = 1): GameState {
  const state = newRun({ runId: `c${seed}`, seed });
  startCombat(state, "cultist");
  state.hp = 200;
  state.maxHp = 200;
  const enemy = state.combat!.enemies[0]!;
  enemy.hp = 100;
  enemy.maxHp = 100;
  enemy.block = 0;
  return state;
}

function enemy(state: GameState): EnemyState {
  return state.combat!.enemies[0]!;
}

/** 把一张牌塞进手牌并打出（目标默认 0 号敌人）。 */
function play(state: GameState, defId: string, upgraded = false, target: number | null = 0): void {
  const card: CardInstance = { uid: state.nextUid++, defId, upgraded };
  state.combat!.hand = [card];
  state.combat!.energy = 3;
  const result = playCard(state, 0, target);
  expect(result.ok).toBe(true);
}

describe("重刃：力量按倍率计入", () => {
  it("基础伤害 14，力量 ×3（力量 4 → 14+12=26）", () => {
    const s = combat();
    addPower(s.combat!.playerPowers, "strength", 4);
    play(s, "heavy_blade");
    expect(enemy(s).hp).toBe(100 - 26);
  });

  it("升级后力量 ×5（力量 4 → 14+20=34）", () => {
    const s = combat();
    addPower(s.combat!.playerPowers, "strength", 4);
    play(s, "heavy_blade", true);
    expect(enemy(s).hp).toBe(100 - 34);
  });

  it("普通攻击仍是 ×1（回归：打击 6+力量4=10）", () => {
    const s = combat();
    addPower(s.combat!.playerPowers, "strength", 4);
    play(s, "strike");
    expect(enemy(s).hp).toBe(100 - 10);
  });
});

describe("上勾拳：伤害 + 虚弱 + 易伤", () => {
  it("造成 13，给 1 虚弱 1 易伤（易伤在结算后加、不放大本次）", () => {
    const s = combat();
    play(s, "uppercut");
    expect(enemy(s).hp).toBe(100 - 13);
    expect(getPower(enemy(s).powers, "weak")).toBe(1);
    expect(getPower(enemy(s).powers, "vulnerable")).toBe(1);
  });

  it("升级给 2 虚弱 2 易伤", () => {
    const s = combat();
    play(s, "uppercut", true);
    expect(getPower(enemy(s).powers, "weak")).toBe(2);
    expect(getPower(enemy(s).powers, "vulnerable")).toBe(2);
  });
});

describe("血魔法：自伤换高伤", () => {
  it("失去 2 生命、造成 15（升级 20）", () => {
    const s = combat();
    play(s, "hemokinesis");
    expect(s.hp).toBe(198);
    expect(enemy(s).hp).toBe(100 - 15);

    const s2 = combat();
    play(s2, "hemokinesis", true);
    expect(s2.hp).toBe(198);
    expect(enemy(s2).hp).toBe(100 - 20);
  });
});

describe("乱拳：多段 + 消耗", () => {
  it("造成 2×4=8 并进消耗堆（升级 2×5=10）", () => {
    const s = combat();
    play(s, "pummel");
    expect(enemy(s).hp).toBe(100 - 8);
    expect(s.combat!.exhaustPile).toHaveLength(1);
    expect(s.combat!.discardPile.some(c => c.defId === "pummel")).toBe(false);

    const s2 = combat();
    play(s2, "pummel", true);
    expect(enemy(s2).hp).toBe(100 - 10);
  });
});

describe("重锤：稀有大攻", () => {
  it("造成 32（升级 42）", () => {
    const s = combat();
    play(s, "bludgeon");
    expect(enemy(s).hp).toBe(100 - 32);

    const s2 = combat();
    play(s2, "bludgeon", true);
    expect(enemy(s2).hp).toBe(100 - 42);
  });
});

describe("狂野劈砍：伤害 + 洗入伤口", () => {
  it("造成 12 并把一张伤口洗入抽牌堆（升级 17）", () => {
    const s = combat();
    const before = s.combat!.drawPile.length;
    play(s, "wild_strike");
    expect(enemy(s).hp).toBe(100 - 12);
    expect(s.combat!.drawPile.filter(c => c.defId === "wound")).toHaveLength(1);
    expect(s.combat!.drawPile.length).toBe(before + 1);

    const s2 = combat();
    play(s2, "wild_strike", true);
    expect(enemy(s2).hp).toBe(100 - 17);
  });

  it("伤口无法打出", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "wound", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    const result = playCard(s, 0, null);
    expect(result.ok).toBe(false);
  });
});

describe("剑刃回旋镖：随机目标多段", () => {
  it("单敌时 3×3=9 全落在它头上（升级 3×4=12）", () => {
    const s = combat();
    play(s, "sword_boomerang", false, null);
    expect(enemy(s).hp).toBe(100 - 9);

    const s2 = combat();
    play(s2, "sword_boomerang", true, null);
    expect(enemy(s2).hp).toBe(100 - 12);
  });

  it("多敌时总伤害 9 分散在存活敌人间、已死的不被选中", () => {
    const s = combat();
    const living2: EnemyState = { ...enemy(s), hp: 100, maxHp: 100, block: 0 };
    const dead: EnemyState = { ...enemy(s), hp: 0, maxHp: 100, block: 0 };
    s.combat!.enemies = [enemy(s), living2, dead];
    play(s, "sword_boomerang", false, null);
    const total = 100 - s.combat!.enemies[0]!.hp + (100 - s.combat!.enemies[1]!.hp);
    expect(total).toBe(9);
    expect(s.combat!.enemies[2]!.hp).toBe(0); // 已死的不被选中，也不会被反弹回血
  });
});

describe("燃怒：能力牌打出后离场", () => {
  it("获得 2 力量，牌不进弃牌/消耗/手牌（升级 3 力量）", () => {
    const s = combat();
    play(s, "inflame", false, null);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
    expect(s.combat!.hand).toHaveLength(0);
    expect(s.combat!.discardPile.some(c => c.defId === "inflame")).toBe(false);
    expect(s.combat!.exhaustPile.some(c => c.defId === "inflame")).toBe(false);

    const s2 = combat();
    play(s2, "inflame", true, null);
    expect(getPower(s2.combat!.playerPowers, "strength")).toBe(3);
  });

  it("力量随后放大普通攻击（燃怒后打击 6+2=8）", () => {
    const s = combat();
    play(s, "inflame", false, null);
    play(s, "strike");
    expect(enemy(s).hp).toBe(100 - 8);
  });
});
