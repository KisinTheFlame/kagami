import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// PR2：第三幕首领/精英收尾——复仇魔（虚无缥缈）、时间吞噬者（时间扭曲 + 加速）。

function combat(encounter: string): GameState {
  const s = newRun({ runId: "a3", seed: 3, character: "ironclad" });
  startCombat(s, encounter);
  s.hp = 400;
  s.maxHp = 400;
  return s;
}

function card(s: GameState, defId: string): CardInstance {
  return { uid: s.nextUid++, defId, upgraded: false };
}

describe("复仇魔：隔回合虚无缥缈", () => {
  it("出招后获得虚无缥缈，玩家攻击被降为 1", () => {
    const s = combat("nemesis");
    const nem = s.combat!.enemies[0]!;
    nem.currentMove = "nem_attack";
    s.combat!.hand = [];
    endTurn(s); // 复仇魔攻击后叠虚无缥缈 2，回合末 -1 → 1
    expect(getPower(nem.powers, "intangible")).toBe(1);
    // 玩家用打击（6 伤害）打它，被虚无缥缈降为 1。
    const before = nem.hp;
    s.combat!.hand = [card(s, "strike")];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(before - nem.hp).toBe(1);
  });

  it("灼烧诅咒：向弃牌堆塞 3 张灼烧", () => {
    const s = combat("nemesis");
    s.combat!.enemies[0]!.currentMove = "nem_debuff";
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.discardPile.filter(c => c.defId === "burn")).toHaveLength(3);
  });

  it("巨镰造成 45 伤害", () => {
    const s = combat("nemesis");
    s.combat!.enemies[0]!.currentMove = "nem_scythe";
    s.combat!.hand = [];
    s.combat!.playerBlock = 0;
    const hpBefore = s.hp;
    endTurn(s);
    expect(hpBefore - s.hp).toBe(45);
  });
});

describe("时间吞噬者：时间扭曲", () => {
  it("玩家打出 12 张牌 → 它 +2 力量并立即结束回合", () => {
    const s = combat("time_eater");
    const te = s.combat!.enemies[0]!;
    te.currentMove = "te_ripple"; // 让被迫的那一回合不打玩家
    s.combat!.hand = Array.from({ length: 12 }, () => card(s, "defend"));
    s.combat!.energy = 99;
    const turnBefore = s.combat!.turn;
    for (let i = 0; i < 12; i += 1) {
      expect(playCard(s, 0, null).ok).toBe(true);
    }
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(2);
    expect(s.combat!.turn).toBe(turnBefore + 1); // 回合被强制结束、进入新回合
  });
});

describe("时间吞噬者：半血加速", () => {
  it("血量降到半血以下 → 下一招加速，回血到半血并清自身减益", () => {
    const s = combat("time_eater");
    const te = s.combat!.enemies[0]!;
    te.hp = 100; // < 456/2
    te.powers.push({ id: "weak", amount: 2 });
    te.currentMove = "te_reverberate";
    s.combat!.hand = [];
    endTurn(s); // 出招后 selectNextMove 选中加速
    expect(s.combat!.enemies[0]!.currentMove).toBe("haste");
    endTurn(s); // 加速结算
    expect(s.combat!.enemies[0]!.hp).toBe(228); // floor(456/2)
    expect(getPower(s.combat!.enemies[0]!.powers, "weak")).toBe(0);
  });
});

describe("时间吞噬者：涟漪 / 头槌", () => {
  it("涟漪：自身 +20 格挡，玩家吃 1 虚弱 1 易伤", () => {
    const s = combat("time_eater");
    s.combat!.enemies[0]!.currentMove = "te_ripple";
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies[0]!.block).toBe(20);
    expect(getPower(s.combat!.playerPowers, "weak")).toBe(1);
    expect(getPower(s.combat!.playerPowers, "vulnerable")).toBe(1);
  });

  it("头槌：26 伤害并使下回合少抽 1 张", () => {
    const s = combat("time_eater");
    s.combat!.enemies[0]!.currentMove = "te_head_slam";
    s.combat!.hand = [];
    s.combat!.playerBlock = 0;
    // 备足抽牌堆，隔离出「少抽 1」的效果。
    s.combat!.drawPile = Array.from({ length: 10 }, () => card(s, "strike"));
    const hpBefore = s.hp;
    endTurn(s);
    expect(hpBefore - s.hp).toBe(26);
    expect(s.combat!.hand).toHaveLength(4); // 正常 5 张 - 1
  });
});
