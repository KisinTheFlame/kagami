import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 机器人补完批 2：条件格挡/随机球/计数能量/移除格挡/偏置认知/缓冲。

function combat(): GameState {
  const s = newRun({ runId: "fd", seed: 18, character: "defect" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  s.combat!.orbs = [];
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("条件 / 计数", () => {
  it("自动护盾：无格挡时给格挡，有格挡则不给", () => {
    const s = combat();
    s.combat!.playerBlock = 0;
    play(s, "auto_shields", null);
    expect(s.combat!.playerBlock).toBe(11);
    s.combat!.playerBlock = 5;
    play(s, "auto_shields", null);
    expect(s.combat!.playerBlock).toBe(5); // 有格挡不追加
  });

  it("堆叠：按弃牌堆张数给格挡", () => {
    const s = combat();
    s.combat!.discardPile = Array.from({ length: 6 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.playerBlock = 0;
    play(s, "stack", null);
    expect(s.combat!.playerBlock).toBe(6);
  });

  it("聚合：抽牌堆每 4 张给 1 能量", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 9 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    play(s, "aggregate", null, 1); // 花 1 费打出
    expect(s.combat!.energy).toBe(2); // 1 - 1 + floor(9/4)=2
  });
});

describe("球 / 移除格挡", () => {
  it("混沌：随机充能 1 颗球", () => {
    const s = combat();
    play(s, "chaos", null);
    expect(s.combat!.orbs).toHaveLength(1);
  });

  it("熔化：移除目标格挡再造成伤害", () => {
    const s = combat();
    s.combat!.enemies[0]!.block = 20;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "melter", 0);
    expect(s.combat!.enemies[0]!.block).toBe(0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 10);
  });

  it("流星：伤害 + 3 等离子球", () => {
    const s = combat();
    s.combat!.orbSlots = 5;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "meteor_strike", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 24);
    expect(s.combat!.orbs.filter(o => o.type === "plasma")).toHaveLength(3);
  });
});

describe("预约能量 / 重编程", () => {
  it("充能电池：下回合 +1 能量", () => {
    const s = combat();
    play(s, "charge_battery", null);
    expect(s.combat!.playerBlock).toBe(7);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.energy).toBe(s.combat!.maxEnergy + 1);
  });

  it("重编程：-集中 +力量 +敏捷", () => {
    const s = combat();
    play(s, "reprogram", null);
    expect(getPower(s.combat!.playerPowers, "focus")).toBe(-1);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(1);
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(1);
  });
});

describe("偏置认知 / 缓冲", () => {
  it("偏置认知：+4 集中，回合始 -1", () => {
    const s = combat();
    play(s, "biased_cognition", null);
    expect(getPower(s.combat!.playerPowers, "focus")).toBe(4);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "focus")).toBe(3);
  });

  it("缓冲：抵消一次穿透伤害", () => {
    const s = combat();
    play(s, "buffer", null);
    s.combat!.playerBlock = 0;
    s.hp = 100;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 攻击 6
    endTurn(s);
    expect(s.hp).toBe(100); // 被缓冲抵消
    expect(getPower(s.combat!.playerPowers, "buffer")).toBe(0);
  });
});
