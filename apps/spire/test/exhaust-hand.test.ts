import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 消耗手牌联动 / 生命偷取（铁甲）：断魂/二度呼吸/恶魔烈焰/收割。

function combat(encounter = "cultist"): GameState {
  const s = newRun({ runId: "exh", seed: 15, character: "ironclad" });
  startCombat(s, encounter);
  s.hp = 100;
  s.maxHp = 200;
  for (const e of s.combat!.enemies) {
    e.hp = 200;
    e.maxHp = 200;
  }
  return s;
}

function inst(s: GameState, defId: string): CardInstance {
  return { uid: s.nextUid++, defId, upgraded: false };
}

describe("二度呼吸：消耗非攻击牌，每张加格挡", () => {
  it("消耗手中非攻击牌，攻击牌保留", () => {
    const s = combat();
    s.combat!.playerBlock = 0;
    s.combat!.hand = [
      inst(s, "second_wind"),
      inst(s, "defend"),
      inst(s, "strike"),
      inst(s, "defend"),
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(10); // 2 张防御 ×5
    expect(s.combat!.hand.map(c => c.defId)).toEqual(["strike"]);
    expect(s.combat!.exhaustPile.filter(c => c.defId === "defend")).toHaveLength(2);
  });
});

describe("断魂：消耗非攻击牌 + 造成伤害", () => {
  it("消耗非攻击牌后造成 16 伤害", () => {
    const s = combat();
    s.combat!.hand = [inst(s, "sever_soul"), inst(s, "defend"), inst(s, "strike")];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 16);
    expect(s.combat!.exhaustPile.some(c => c.defId === "defend")).toBe(true);
    expect(s.combat!.hand.map(c => c.defId)).toEqual(["strike"]);
  });
});

describe("恶魔烈焰：消耗全手牌，每张一击", () => {
  it("消耗其余手牌，按张数造成伤害", () => {
    const s = combat();
    s.combat!.hand = [
      inst(s, "fiend_fire"),
      inst(s, "strike"),
      inst(s, "defend"),
      inst(s, "strike"),
    ];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 其余 3 张被消耗，每张 7 → 21。
    expect(s.combat!.enemies[0]!.hp).toBe(before - 21);
    expect(s.combat!.hand).toHaveLength(0);
  });
});

describe("收割：AoE + 回血", () => {
  it("对所有敌人造成伤害并回复等量生命", () => {
    const s = combat("two_fungi_beasts");
    for (const e of s.combat!.enemies) {
      e.hp = 20;
      e.block = 0;
    }
    s.hp = 50;
    s.maxHp = 200;
    s.combat!.hand = [inst(s, "reaper")];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 两个敌人各 4 伤 → 回 8。
    expect(s.hp).toBe(58);
  });
});

describe("卡池归属", () => {
  it("消耗/偷取牌进入红池", () => {
    expect(cardPoolOf("red", "uncommon")).toContain("second_wind");
    expect(cardPoolOf("red", "uncommon")).toContain("sever_soul");
    expect(cardPoolOf("red", "rare")).toContain("fiend_fire");
    expect(cardPoolOf("red", "rare")).toContain("reaper");
  });
});
