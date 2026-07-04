import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 十卡批次中的机制：穿刺尖啸 / 巧计一击 / 火焰屏障 / 白噪音 / 分心 / 裂变 / 蜕变 / 变形。

function combat(character: "silent" | "ironclad" | "defect" | "watcher"): GameState {
  const s = newRun({ runId: "b10", seed: 57, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("穿刺尖啸：削所有敌人力量，行动后归还", () => {
  it("双敌各 -6 力量并记枷锁", () => {
    const s = combat("silent");
    s.combat!.enemies.push({ ...s.combat!.enemies[0]!, powers: [{ id: "strength", amount: 4 }] });
    s.combat!.enemies[0]!.powers = [{ id: "strength", amount: 2 }];
    play(s, "piercing_wail", null);
    expect(getPower(s.combat!.enemies[0]!.powers, "strength")).toBe(-4);
    expect(getPower(s.combat!.enemies[1]!.powers, "strength")).toBe(-2);
    expect(getPower(s.combat!.enemies[0]!.powers, "shackled")).toBe(6);
  });
});

describe("巧计一击：费用按失血次数上调", () => {
  it("失血 2 次 → 费用 0+2=2", () => {
    const s = combat("ironclad");
    s.combat!.timesLostHpThisCombat = 2;
    const card: CardInstance = { uid: s.nextUid++, defId: "masterful_stab", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 1; // 不够 2。
    expect(playCard(s, 0, 0).ok).toBe(false);
    s.combat!.energy = 2;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
  });
});

describe("火焰屏障：本回合被攻击反弹", () => {
  it("挂屏障后敌人攻击受反弹，回合末清除", () => {
    const s = combat("ironclad");
    s.combat!.playerBlock = 0;
    play(s, "flame_barrier", null);
    expect(getPower(s.combat!.playerPowers, "flame_barrier")).toBe(4);
    const enemyHp = s.combat!.enemies[0]!.hp;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 敌人攻击 → 受 4 反弹
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBe(enemyHp - 4);
    // 新回合屏障已清除。
    expect(getPower(s.combat!.playerPowers, "flame_barrier")).toBe(0);
  });
});

describe("白噪音 / 分心：随机免费牌入手", () => {
  it("白噪音加入一张免费能力牌", () => {
    const s = combat("defect");
    play(s, "white_noise", null);
    const added = s.combat!.hand.find(c => c.costZero);
    expect(added).toBeDefined();
    expect(getCardDef(added!.defId).type).toBe("power");
  });
  it("分心加入一张免费技能牌", () => {
    const s = combat("silent");
    play(s, "distraction", null);
    const added = s.combat!.hand.find(c => c.costZero);
    expect(added).toBeDefined();
    expect(getCardDef(added!.defId).type).toBe("skill");
  });
});

describe("裂变：唤醒所有球，每颗给能量+抽牌", () => {
  it("2 颗球 → +2 能量、抽 2", () => {
    const s = combat("defect");
    s.combat!.orbs = [{ type: "frost" }, { type: "frost" }];
    s.combat!.orbSlots = 3;
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    const card: CardInstance = { uid: s.nextUid++, defId: "fission", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 0;
    const handBefore = 0;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.energy).toBe(2);
    expect(s.combat!.orbs).toHaveLength(0);
    expect(s.combat!.hand.filter(c => c.defId === "strike").length).toBe(handBefore + 2);
  });
});

describe("蜕变 / 变形：随机免费牌洗入抽牌堆", () => {
  it("蜕变洗入 3 张免费技能", () => {
    const s = combat("watcher");
    s.combat!.drawPile = [];
    play(s, "chrysalis", null);
    const added = s.combat!.drawPile.filter(c => c.costZero);
    expect(added).toHaveLength(3);
    expect(added.every(c => getCardDef(c.defId).type === "skill")).toBe(true);
  });
  it("变形洗入 3 张免费攻击", () => {
    const s = combat("watcher");
    s.combat!.drawPile = [];
    play(s, "metamorphosis", null);
    const added = s.combat!.drawPile.filter(c => c.costZero);
    expect(added).toHaveLength(3);
    expect(added.every(c => getCardDef(c.defId).type === "attack")).toBe(true);
  });
});
