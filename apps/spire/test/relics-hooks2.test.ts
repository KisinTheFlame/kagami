import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, usePotion } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import type { CardInstance, Effect, GameState, RelicState } from "../src/engine/types.js";

// PR（消耗/击杀/用药水 触发型遗物 + 三个新钩子）。

function run(): GameState {
  return newRun({ runId: "rh2", seed: 3, character: "ironclad" });
}
function card(s: GameState, defId: string): CardInstance {
  return { uid: s.nextUid++, defId, upgraded: false };
}
function emitOf(id: string, hook: "onExhaust" | "onEnemyKilled" | "onUsePotion"): Effect[] {
  const self: RelicState = { id, counter: 0 };
  const out: Effect[] = [];
  getRelicDef(id).hooks[hook]?.(run(), self, e => out.push(e));
  return out;
}

describe("钩子发射内容", () => {
  it("卡戎之烬：消耗 → 全体 3 伤害", () => {
    expect(emitOf("charons_ashes", "onExhaust")).toEqual([{ kind: "deal_damage_all", amount: 3 }]);
  });
  it("枯枝：消耗 → 加一张随机无色牌", () => {
    expect(emitOf("dead_branch", "onExhaust")).toEqual([
      { kind: "add_random_colorless", count: 1 },
    ]);
  });
  it("哥布林之角：击杀 → +1 能量 + 抽 1", () => {
    expect(emitOf("gremlin_horn", "onEnemyKilled")).toEqual([
      { kind: "gain_energy", amount: 1 },
      { kind: "draw", amount: 1 },
    ]);
  });
});

describe("玩具扑翼机：用药水回 5 血（onUsePotion 端到端）", () => {
  it("使用药水后回复 5 生命", () => {
    const s = run();
    grantRelic(s, "toy_ornithopter");
    startCombat(s, "cultist");
    s.hp = 100;
    s.maxHp = 200;
    s.potions[0] = "block_potion";
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(s.hp).toBe(105);
  });
});

describe("卡戎之烬：消耗触发 AoE（onExhaust 端到端）", () => {
  it("用灵丹药水消耗一张技能 → 敌人吃 3 伤害", () => {
    const s = run();
    grantRelic(s, "charons_ashes");
    startCombat(s, "cultist");
    s.hp = 200;
    s.maxHp = 200;
    s.combat!.hand = [card(s, "defend")]; // 非攻击，将被灵丹消耗
    s.potions[0] = "elixir_potion";
    const before = s.combat!.enemies[0]!.hp;
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(before - s.combat!.enemies[0]!.hp).toBe(3);
  });
});
