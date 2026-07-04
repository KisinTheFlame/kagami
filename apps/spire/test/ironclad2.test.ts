import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 铁甲收尾：冲撞 / 战吼 / 坚毅 / 战意。

function combat(): GameState {
  const s = newRun({ runId: "i2", seed: 31, character: "ironclad" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("冲撞：手牌全攻击才发挥", () => {
  it("其余手牌全攻击 → 14 伤", () => {
    const s = combat();
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "clash", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 14);
  });

  it("含技能 → 无伤", () => {
    const s = combat();
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "clash", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    s.combat!.energy = 9;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.enemies[0]!.hp).toBe(before);
  });
});

describe("坚毅：格挡 + 随机消耗", () => {
  it("获得格挡并消耗一张手牌", () => {
    const s = combat();
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "true_grit", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.playerBlock = 0;
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(7);
    // true_grit 离手 + 随机消耗 1（唯一剩余 strike）→ 手牌空，消耗堆有 strike。
    expect(s.combat!.hand).toHaveLength(0);
    expect(s.combat!.exhaustPile.some(c => c.defId === "strike")).toBe(true);
  });
});

describe("战意：抽 3 后本回合禁抽", () => {
  it("抽 3 张，之后再抽无效", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [{ uid: s.nextUid++, defId: "battle_trance", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(3);
    expect(getPower(s.combat!.playerPowers, "no_draw")).toBe(1);
    // 再打一张抽牌卡（剑柄打击造成伤害并抽 1）→ 抽牌被禁。
    const handSize = s.combat!.hand.length;
    const card: CardInstance = { uid: s.nextUid++, defId: "pommel_strike", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    playCard(s, 0, 0);
    // 剑柄打击应抽 1，但战意禁抽 → 手牌不增（仅 pommel 离手）。
    expect(s.combat!.hand).toHaveLength(0);
    void handSize;
  });
});
