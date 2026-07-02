import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { addPower, getPower, removePower } from "../src/engine/powers/powers.js";
import type { CardInstance, EnemyState, GameState } from "../src/engine/types.js";

// M3b-2：拉加维林——睡眠状态机 + 金属化 + 吸取灵魂（减力量/敏捷）+ 敏捷改格挡。asc0。

function lagFight(seed = 1): GameState {
  const s = newRun({ runId: `lag${seed}`, seed });
  startCombat(s, "lagavulin");
  s.hp = 500;
  s.maxHp = 500;
  return s;
}

function lag(s: GameState): EnemyState {
  return s.combat!.enemies[0]!;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("拉加维林：开局睡眠", () => {
  it("HP 109-111，开局沉睡 + 金属化8 + 8格挡 + 首招沉睡", () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const s = lagFight(seed);
      expect(lag(s).hp).toBeGreaterThanOrEqual(109);
      expect(lag(s).hp).toBeLessThanOrEqual(111);
    }
    const s = lagFight();
    expect(lag(s).asleep).toBe(true);
    expect(getPower(lag(s).powers, "metallicize")).toBe(8);
    expect(lag(s).block).toBe(8);
    expect(lag(s).currentMove).toBe("sleep");
  });

  it("睡眠期每回合结束回满 8 格挡、不攻击玩家", () => {
    const s = lagFight();
    endTurn(s);
    expect(lag(s).block).toBe(8);
    expect(s.hp).toBe(500); // 睡觉不打人
  });
});

describe("拉加维林：苏醒", () => {
  it("睡满第 3 回合自然苏醒、清金属化、改出重击", () => {
    const s = lagFight();
    endTurn(s);
    endTurn(s);
    endTurn(s);
    expect(lag(s).asleep).toBe(false);
    expect(getPower(lag(s).powers, "metallicize")).toBe(0);
    expect(lag(s).currentMove).toBe("lag_attack");
  });

  it("受到穿透格挡的伤害立即苏醒并清金属化", () => {
    const s = lagFight();
    play(s, "bludgeon"); // 32 伤，破 8 格挡 → 苏醒
    expect(lag(s).asleep).toBe(false);
    expect(getPower(lag(s).powers, "metallicize")).toBe(0);
  });

  it("苏醒后重击造成 18", () => {
    const s = lagFight();
    endTurn(s);
    endTurn(s);
    endTurn(s); // 苏醒，telegraph 重击
    endTurn(s); // 执行重击
    expect(s.hp).toBe(500 - 18);
  });
});

describe("吸取灵魂 + 敏捷", () => {
  it("吸取灵魂令玩家 -1 力量 -1 敏捷", () => {
    const s = lagFight();
    const l = lag(s);
    l.asleep = false;
    removePower(l.powers, "metallicize");
    l.currentMove = "siphon_soul";
    addPower(s.combat!.playerPowers, "strength", 2);
    addPower(s.combat!.playerPowers, "dexterity", 2);
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(1);
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(1);
  });

  it("敏捷改变获得的格挡（+2 → 防御5给7；-3 → 给2）", () => {
    const s = lagFight();
    addPower(s.combat!.playerPowers, "dexterity", 2);
    play(s, "defend", null);
    expect(s.combat!.playerBlock).toBe(7);

    const s2 = lagFight();
    addPower(s2.combat!.playerPowers, "dexterity", -3);
    play(s2, "defend", null);
    expect(s2.combat!.playerBlock).toBe(2);
  });
});
