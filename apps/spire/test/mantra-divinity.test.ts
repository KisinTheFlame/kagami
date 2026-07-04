import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState, PowerId } from "../src/engine/types.js";

// 法力 / 神性（观者）：法力累积到 10 进入神性（攻击 ×3、回合末退出）+ 姿态触发型能力。

function combat(): GameState {
  const s = newRun({ runId: "mantra", seed: 12, character: "watcher" });
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

/** 打一张牌，能量拉满。 */
function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("法力累积", () => {
  it("叩拜给格挡 + 法力", () => {
    const s = combat();
    s.combat!.playerBlock = 0;
    play(s, "prostrate", null);
    expect(s.combat!.playerBlock).toBe(4);
    expect(s.combat!.mantra).toBe(2);
  });

  it("法力达到 10 → 进入神性、清空法力、+3 能量", () => {
    const s = combat();
    s.combat!.mantra = 8;
    // 手动打叩拜(+2)，控制能量看 +3。
    const card: CardInstance = { uid: s.nextUid++, defId: "prostrate", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerStance).toBe("divinity");
    expect(s.combat!.mantra).toBe(0);
    expect(s.combat!.energy).toBe(6); // 3 + 3（叩拜 0 费）
  });

  it("敬拜 +5 法力", () => {
    const s = combat();
    play(s, "worship", null);
    expect(s.combat!.mantra).toBe(5);
  });
});

describe("神性姿态", () => {
  it("神性下攻击 ×3", () => {
    const s = combat();
    s.combat!.playerStance = "divinity";
    const before = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0); // 6 → ×3 = 18
    expect(s.combat!.enemies[0]!.hp).toBe(before - 18);
  });

  it("回合结束退出神性", () => {
    const s = combat();
    s.combat!.playerStance = "divinity";
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.playerStance).toBe("none");
  });
});

describe("姿态触发型能力", () => {
  it("虔诚：回合开始 +2 法力", () => {
    const s = combat();
    grant(s, "devotion", 2);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.mantra).toBe(2);
  });

  it("心之堡垒：改变姿态获得格挡", () => {
    const s = combat();
    grant(s, "mental_fortress", 4);
    s.combat!.playerBlock = 0;
    play(s, "crescendo", null); // 进入愤怒 → 心之堡垒 +4
    expect(s.combat!.playerBlock).toBe(4);
  });

  it("疾攻：进入愤怒抽牌", () => {
    const s = combat();
    grant(s, "rushdown", 2);
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    const card: CardInstance = { uid: s.nextUid++, defId: "crescendo", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // crescendo 消耗离手，疾攻抽 2 → 手牌 2 张。
    expect(s.combat!.hand).toHaveLength(2);
  });
});

describe("卡池归属", () => {
  it("法力/神性牌进入紫池", () => {
    expect(cardPoolOf("purple", "common")).toContain("prostrate");
    expect(cardPoolOf("purple", "uncommon")).toContain("worship");
    expect(cardPoolOf("purple", "uncommon")).toContain("devotion");
    expect(cardPoolOf("purple", "uncommon")).toContain("rushdown");
  });
});
