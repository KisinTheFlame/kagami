import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 静默补完批 1：固有/下回合预约/虚无缥缈/弃牌/随机毒/终结技等新机制。

function combat(): GameState {
  const s = newRun({ runId: "fs", seed: 17, character: "silent" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("固有：背刺开局在手", () => {
  it("含背刺的牌组开局起手必有背刺", () => {
    const s = newRun({ runId: "innate", seed: 3, character: "silent" });
    s.deck.push({ uid: s.nextUid++, defId: "backstab", upgraded: false });
    startCombat(s, "cultist");
    expect(s.combat!.hand.some(c => c.defId === "backstab")).toBe(true);
  });
});

describe("下回合预约", () => {
  it("闪转腾挪：格挡跨回合保留（下回合始 +4）", () => {
    const s = combat();
    play(s, "dodge_and_roll", null);
    expect(s.combat!.playerBlock).toBe(4);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 新回合清空当前格挡后加预约 4。
    expect(s.combat!.playerBlock).toBe(4);
  });

  it("飞膝：下回合 +1 能量", () => {
    const s = combat();
    play(s, "flying_knee", 0);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.energy).toBe(s.combat!.maxEnergy + 1);
  });

  it("掠食者：下回合多抽 2", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    play(s, "predator", 0);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand.length).toBe(7); // 5 + 预约 2
  });
});

describe("疾影：格挡不在回合始清空", () => {
  it("疾影本回合格挡保留到下回合", () => {
    const s = combat();
    play(s, "blur", null);
    s.combat!.playerBlock = 12;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.playerBlock).toBeGreaterThanOrEqual(12);
  });
});

describe("虚无缥缈：伤害降为 1", () => {
  it("幽灵形态下受到的攻击伤害为 1", () => {
    const s = combat();
    play(s, "wraith_form", null);
    s.combat!.playerBlock = 0;
    s.hp = 100;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 攻击 6
    endTurn(s);
    expect(s.hp).toBe(99); // 只掉 1
  });
});

describe("终结技 / 弃牌 / 随机毒", () => {
  it("终结技：按本回合此前攻击数结算", () => {
    const s = combat();
    // 先打 2 张攻击。
    play(s, "strike", 0);
    play(s, "strike", 0);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "finisher", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 12); // 6×2
  });

  it("卸货：弃掉非攻击牌", () => {
    const s = combat();
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "unload", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.hand.map(c => c.defId)).toEqual(["strike"]);
    expect(s.combat!.discardPile.some(c => c.defId === "defend")).toBe(true);
  });

  it("弹跳药瓶：单敌吃满 9 层毒", () => {
    const s = combat();
    play(s, "bouncing_flask", null);
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBe(9); // 3×3
  });

  it("专精：抽到 6 张", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [{ uid: s.nextUid++, defId: "expertise", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand).toHaveLength(6);
  });
});
