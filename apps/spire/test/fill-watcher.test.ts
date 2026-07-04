import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState, PowerId } from "../src/engine/types.js";

// 观者补完批 3 + 铁甲收尾：战歌/苦修/止/审判/衍生token/屈伸/暴怒。

function combat(character: GameState["character"] = "watcher"): GameState {
  const s = newRun({ runId: "fw", seed: 19, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function grant(s: GameState, power: PowerId, amount: number): void {
  s.combat!.playerPowers.push({ id: power, amount });
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("观者补完", () => {
  it("战歌：回合始加痛斩", () => {
    const s = combat();
    play(s, "battle_hymn", null);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand.some(c => c.defId === "smite")).toBe(true);
  });

  it("苦修：+力量+敏捷，最大能量 -1", () => {
    const s = combat();
    const maxBefore = s.combat!.maxEnergy;
    play(s, "fasting", null);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(3);
    expect(getPower(s.combat!.playerPowers, "dexterity")).toBe(3);
    expect(s.combat!.maxEnergy).toBe(maxBefore - 1);
  });

  it("止：无姿态给 3，愤怒给 12", () => {
    const s = combat();
    s.combat!.playerBlock = 0;
    play(s, "halt", null);
    expect(s.combat!.playerBlock).toBe(3);
    s.combat!.playerStance = "wrath";
    s.combat!.playerBlock = 0;
    play(s, "halt", null);
    expect(s.combat!.playerBlock).toBe(12);
  });

  it("审判：低血直接击杀", () => {
    const s = newRun({ runId: "judge", seed: 5, character: "watcher" });
    startCombat(s, "two_fungi_beasts"); // 双敌，杀一个战斗不结束
    s.combat!.enemies[0]!.hp = 25;
    s.combat!.enemies[1]!.hp = 100;
    play(s, "judgment", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(0);
  });

  it("欺骗现实：格挡 + 安全token", () => {
    const s = combat();
    play(s, "deceive_reality", null);
    expect(s.combat!.hand.some(c => c.defId === "safety")).toBe(true);
  });

  it("祈祷：法力 + 洞悉洗入抽牌堆", () => {
    const s = combat();
    play(s, "pray", null);
    expect(s.combat!.mantra).toBe(3);
    expect(s.combat!.drawPile.some(c => c.defId === "insight")).toBe(true);
  });

  it("登天：伤害 + 以暴制暴洗入抽牌堆", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    play(s, "reach_heaven", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 10);
    expect(s.combat!.drawPile.some(c => c.defId === "through_violence")).toBe(true);
  });
});

describe("铁甲收尾", () => {
  it("屈伸：临时力量回合末失去", () => {
    const s = combat("ironclad");
    play(s, "flex", null);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(0);
  });

  it("暴怒：本回合每打出攻击加格挡", () => {
    const s = combat("ironclad");
    grant(s, "rage", 3);
    s.combat!.playerBlock = 0;
    play(s, "strike", 0);
    expect(s.combat!.playerBlock).toBe(3);
    play(s, "strike", 0);
    expect(s.combat!.playerBlock).toBe(6);
  });
});
