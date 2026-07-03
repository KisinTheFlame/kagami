import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn, usePotion } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { REWARD_RELIC_POOL } from "../src/engine/relics/relics.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// A-发伤遗物：荆棘（玩家反弹）+ 青铜鳞片 + 开信刀（遗物 emit Effect）。

function fightWith(relicId: string, encounter = "cultist"): GameState {
  const s = newRun({ runId: relicId, seed: 1 });
  s.relics = [{ id: relicId, counter: 0 }];
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  for (const e of s.combat!.enemies) {
    e.hp = 100;
    e.maxHp = 100;
  }
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("荆棘：被攻击反弹", () => {
  it("青铜鳞片战斗开始给 3 荆棘；敌人攻击时反弹 3", () => {
    const s = fightWith("bronze_scales");
    expect(getPower(s.combat!.playerPowers, "thorns")).toBe(3);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.hp = 50;
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 邪教徒暗袭（攻击玩家）
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBe(47); // 反弹 3
  });

  it("多段攻击每段各反弹（用液态青铜给玩家荆棘）", () => {
    const s = newRun({ runId: "lb", seed: 1 });
    startCombat(s, "guardian"); // 守卫者旋风 5×4 多段
    s.hp = 9999;
    s.maxHp = 9999;
    s.potions[0] = "liquid_bronze";
    expect(usePotion(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "thorns")).toBe(3);
    const g = s.combat!.enemies[0]!;
    g.hp = 200;
    g.currentMove = "whirlwind"; // 5×4 四段攻击
    s.combat!.hand = [];
    endTurn(s);
    expect(g.hp).toBe(200 - 3 * 4); // 每段反弹 3，共 4 段
  });
});

describe("开信刀：遗物 emit Effect", () => {
  it("每 3 张技能牌，对所有敌人造成 5", () => {
    const s = fightWith("letter_opener", "two_fungi_beasts"); // 无蜷缩护盾
    const hp0 = s.combat!.enemies.map(e => e.hp);
    play(s, "defend"); // 技能 1
    play(s, "defend"); // 技能 2
    // 尚未触发
    expect(s.combat!.enemies[0]!.hp).toBe(hp0[0]!);
    play(s, "defend"); // 技能 3 → emit deal_damage_all 5
    for (let i = 0; i < s.combat!.enemies.length; i += 1) {
      expect(s.combat!.enemies[i]!.hp).toBe(hp0[i]! - 5);
    }
  });

  it("攻击牌不计入开信刀计数", () => {
    const s = fightWith("letter_opener");
    const hp0 = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0); // 攻击，造成 6 但不推进技能计数
    play(s, "strike", 0);
    play(s, "strike", 0);
    // 只有打击伤害 6×3=18，没有开信刀的 5
    expect(s.combat!.enemies[0]!.hp).toBe(hp0 - 18);
  });
});

describe("遗物入池", () => {
  it("青铜鳞片/开信刀进奖励池", () => {
    expect(REWARD_RELIC_POOL).toContain("bronze_scales");
    expect(REWARD_RELIC_POOL).toContain("letter_opener");
  });
});
