import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { pickBossEncounter } from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import type { CardInstance, EnemyState, GameState } from "../src/engine/types.js";

// M3d-1：六火之灵——激活锁伤 → 分割6连 → 7 段仪轨；灼烧废牌。asc0。

function hexFight(hp = 500): GameState {
  const s = newRun({ runId: "hex", seed: 1 });
  startCombat(s, "hexaghost");
  s.hp = hp;
  s.maxHp = 500;
  return s;
}

function hex(s: GameState): EnemyState {
  return s.combat!.enemies[0]!;
}

describe("六火之灵：开局与仪轨", () => {
  it("HP 250，首招激活", () => {
    const s = hexFight();
    expect(hex(s).hp).toBe(250);
    expect(hex(s).currentMove).toBe("activate");
  });

  it("固定序列：激活→分割→灼烧→冲撞→灼烧→燃焰→冲撞→灼烧→地狱火→灼烧(循环)", () => {
    const s = hexFight();
    const seq: string[] = [hex(s).currentMove];
    for (let i = 0; i < 9; i += 1) {
      endTurn(s);
      seq.push(hex(s).currentMove);
    }
    expect(seq).toEqual([
      "activate",
      "divider",
      "sear",
      "tackle",
      "sear",
      "inflame",
      "tackle",
      "sear",
      "inferno",
      "sear",
    ]);
  });
});

describe("分割伤害按玩家生命锁定", () => {
  it("玩家 120 血 → 每击 floor(120/12)+1=11，×6=66", () => {
    const s = hexFight(120);
    endTurn(s); // 激活：锁定每击 11
    expect(hex(s).rolledDamage).toBe(11);
    endTurn(s); // 分割：11×6=66
    expect(s.hp).toBe(120 - 66);
  });

  it("激活本身不造成伤害", () => {
    const s = hexFight(120);
    endTurn(s);
    expect(s.hp).toBe(120);
  });
});

describe("灼烧废牌", () => {
  it("灼烧塞 1 张灼烧进弃牌堆", () => {
    const s = hexFight();
    hex(s).currentMove = "sear";
    const before = s.combat!.discardPile.filter(c => c.defId === "burn").length;
    endTurn(s);
    const after = s.combat!.discardPile.filter(c => c.defId === "burn").length;
    expect(after - before).toBe(1);
  });

  it("手牌里的灼烧回合结束造成 2 伤害（经格挡）", () => {
    const s = hexFight(100);
    const burn: CardInstance = { uid: s.nextUid++, defId: "burn", upgraded: false };
    s.combat!.hand = [burn];
    endTurn(s);
    expect(s.hp).toBe(98); // 激活无伤，仅灼烧 2

    const s2 = hexFight(100);
    const burn2: CardInstance = { uid: s2.nextUid++, defId: "burn", upgraded: false };
    s2.combat!.hand = [burn2];
    s2.combat!.playerBlock = 5;
    endTurn(s2);
    expect(s2.hp).toBe(100); // 格挡吸收 2
  });
});

describe("燃焰", () => {
  it("获得 12 格挡 + 2 力量", () => {
    const s = hexFight();
    hex(s).currentMove = "inflame";
    endTurn(s);
    expect(hex(s).block).toBe(12);
    expect(getPower(hex(s).powers, "strength")).toBe(2);
  });
});

describe("Boss 随机选择", () => {
  it("能选到 guardian 和 hexaghost，且只在 Boss 池内", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      seen.add(pickBossEncounter(seedRng(seed)));
    }
    expect(seen.has("guardian")).toBe(true);
    expect(seen.has("hexaghost")).toBe(true);
    for (const id of seen) {
      expect(["guardian", "hexaghost", "slime_boss"]).toContain(id);
    }
  });
});
