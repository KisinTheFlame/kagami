import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { REWARD_RELIC_POOL, SHOP_RELIC_POOL, getRelicDef } from "../src/engine/relics/relics.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// A3：遗物钩子扩展（onTurnStart/onTurnEnd/onCardPlayed）+ 9 个新遗物。

function fightWith(relicId: string): GameState {
  const s = newRun({ runId: relicId, seed: 1 });
  s.relics = [{ id: relicId, counter: 0 }];
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function playN(s: GameState, defId: string, times: number): void {
  for (let i = 0; i < times; i += 1) {
    const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
  }
}

describe("出牌计数遗物（onCardPlayed）", () => {
  it("手里剑：每 3 张攻击 +1 力量", () => {
    const s = fightWith("shuriken");
    playN(s, "strike", 2);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(0);
    playN(s, "strike", 1); // 第 3 张
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(1);
  });

  it("苦无：每 3 张攻击 +1 敏捷；技能牌不计数", () => {
    const s = fightWith("kunai");
    playN(s, "defend", 3); // 技能，不计
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(0);
    playN(s, "strike", 3);
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(1);
  });

  it("鸟面瓮：每打一张能力牌回 2 血", () => {
    const s = fightWith("bird_faced_urn");
    s.hp = 100;
    playN(s, "inflame", 1); // 能力牌
    expect(s.hp).toBe(102);
  });
});

describe("回合钩子", () => {
  it("欢乐花：每 3 回合开始 +1 能量（第 1 回合即第 1 次计数）", () => {
    const s = fightWith("happy_flower");
    // 第1回合开始已计数1；结束进第2回合计数2、第3回合计数3→触发
    s.combat!.hand = [];
    endTurn(s); // 第2回合
    const e2 = s.combat!.energy;
    s.combat!.hand = [];
    endTurn(s); // 第3回合 → +1 能量
    expect(s.combat!.energy).toBe(e2 + 1);
  });

  it("角锚：第 2 回合开始 +14 格挡", () => {
    const s = fightWith("horn_cleat");
    expect(s.combat!.playerBlock).toBe(0); // 第1回合无
    s.combat!.hand = [];
    endTurn(s); // 进入第2回合
    expect(s.combat!.playerBlock).toBe(14);
  });

  it("山铜：回合结束无格挡则 +6（下回合开始前生效）", () => {
    const s = fightWith("orichalcum");
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 暗袭 6
    s.hp = 100;
    endTurn(s);
    // 回合末补 6 格挡，正好挡下暗袭 6 → 不掉血
    expect(s.hp).toBe(100);
  });

  it("光滑石：战斗开始 +1 敏捷", () => {
    const s = fightWith("oddly_smooth_stone");
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(1);
  });
});

describe("战斗结束钩子", () => {
  it("带肉骨头：低于半血时战斗结束回 12", () => {
    const s = fightWith("meat_on_the_bone");
    s.hp = 100;
    s.maxHp = 300; // 低于一半
    s.combat!.enemies[0]!.hp = 1;
    playN(s, "bludgeon", 1); // 秒杀 → 战斗结束
    expect(s.hp).toBe(112);
  });
});

describe("遗物池分层", () => {
  it("奖励池 = common+uncommon（不含 rare），商店池含 rare", () => {
    for (const id of REWARD_RELIC_POOL) {
      expect(["common", "uncommon"]).toContain(getRelicDef(id).rarity);
    }
    expect(SHOP_RELIC_POOL).toContain("bird_faced_urn"); // rare 只在商店池
    expect(REWARD_RELIC_POOL).not.toContain("bird_faced_urn");
  });
});
