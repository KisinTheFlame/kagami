import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState, PowerId } from "../src/engine/types.js";

// 更多触发型能力：机器学习/风暴/散热/静电放电（机器人）+ 进化/腐化（铁甲）。

function combat(character: GameState["character"] = "defect"): GameState {
  const s = newRun({ runId: "mt", seed: 13, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  s.combat!.orbs = [];
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

describe("风暴 / 散热：打出能力牌触发", () => {
  it("风暴：打出能力牌充能闪电球", () => {
    const s = combat();
    grant(s, "storm", 1);
    play(s, "defragment", null); // 蓝能力牌
    expect(s.combat!.orbs.some(o => o.type === "lightning")).toBe(true);
  });

  it("散热：打出能力牌抽牌", () => {
    const s = combat();
    grant(s, "heatsinks", 1);
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    play(s, "defragment", null);
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
  });

  it("非能力牌不触发风暴", () => {
    const s = combat();
    grant(s, "storm", 1);
    play(s, "strike", 0);
    expect(s.combat!.orbs).toHaveLength(0);
  });
});

describe("静电放电：受击充能", () => {
  it("受到穿透格挡的攻击伤害 → 充能闪电球", () => {
    const s = combat();
    grant(s, "static_discharge", 1);
    s.combat!.playerBlock = 0;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 邪教徒攻击 6
    endTurn(s);
    expect(s.combat!.orbs.some(o => o.type === "lightning")).toBe(true);
  });
});

describe("机器学习：回合始多抽", () => {
  it("新回合多抽 = 层数的牌", () => {
    const s = combat();
    grant(s, "machine_learning", 1);
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand).toHaveLength(6); // 5 + 机器学习 1
  });
});

describe("进化：抽到状态牌额外抽", () => {
  it("抽到状态牌触发额外抽", () => {
    const s = combat("ironclad");
    grant(s, "evolve", 1);
    // drawPile 末尾先被抽：wound 先抽 → 进化 → 抽 strike。
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "wound", upgraded: false },
    ];
    s.combat!.hand = [];
    play(s, "pommel_strike", 0); // 造成伤害 + 抽 1（触发进化）
    expect(s.combat!.hand.some(c => c.defId === "wound")).toBe(true);
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
  });
});

describe("腐化：技能费 0 + 消耗", () => {
  it("持有腐化时技能费 0 且打出后进消耗堆", () => {
    const s = combat("ironclad");
    grant(s, "corruption", 1);
    const card: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 0; // 腐化把技能费降到 0，能量 0 也能打
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.exhaustPile.some(c => c.defId === "defend")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "defend")).toBe(false);
  });
});

describe("卡池归属", () => {
  it("新能力牌进入正确池", () => {
    expect(cardPoolOf("blue", "uncommon")).toContain("storm");
    expect(cardPoolOf("blue", "uncommon")).toContain("machine_learning");
    expect(cardPoolOf("red", "uncommon")).toContain("evolve");
    expect(cardPoolOf("red", "rare")).toContain("corruption");
  });
});
