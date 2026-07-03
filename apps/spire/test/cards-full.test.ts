import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { generateShop } from "../src/engine/shop/shop.js";
import { getCardDef, cardPoolOf, rewardCardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState, PowerInstance } from "../src/engine/types.js";

// 卡池补全：新原语（回复/力量翻倍）、退出姿态、洗牌自我复制、加牌进手、池归属。

function combat(character: GameState["character"] = "ironclad", encounter = "cultist"): GameState {
  const s = newRun({ runId: "cards", seed: 3, character });
  startCombat(s, encounter);
  s.hp = 200;
  s.maxHp = 200;
  return s;
}

function playOnly(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("新原语：回复固定生命", () => {
  it("包扎回复 4 点，且不超过最大生命", () => {
    const s = combat();
    s.hp = 190;
    playOnly(s, "bandage_up", null);
    expect(s.hp).toBe(194);
    s.hp = 199;
    playOnly(s, "bandage_up", null);
    expect(s.hp).toBe(200); // 不溢出
  });
});

describe("新原语：力量翻倍", () => {
  it("极限爆发使当前力量翻倍", () => {
    const s = combat();
    const str: PowerInstance = { id: "strength", amount: 3 };
    s.combat!.playerPowers = [str];
    playOnly(s, "limit_break", null);
    expect(s.combat!.playerPowers.find(p => p.id === "strength")?.amount).toBe(6);
  });

  it("无力量时翻倍为无操作（仍为 0）", () => {
    const s = combat();
    s.combat!.playerPowers = [];
    playOnly(s, "limit_break", null);
    expect(s.combat!.playerPowers.find(p => p.id === "strength")?.amount ?? 0).toBe(0);
  });
});

describe("退出姿态", () => {
  it("空身退出愤怒姿态回到无", () => {
    const s = combat("watcher");
    s.combat!.playerStance = "wrath";
    playOnly(s, "empty_body", null);
    expect(s.combat!.playerStance).toBe("none");
  });

  it("空身从平静退出 +2 能量（离开平静奖励）", () => {
    const s = combat("watcher");
    s.combat!.playerStance = "calm";
    const card: CardInstance = { uid: s.nextUid++, defId: "empty_body", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerStance).toBe("none");
    expect(s.combat!.energy).toBe(4); // 空身 1 费：3-1+2=4
  });
});

describe("撒泼：洗一张本牌进抽牌堆并进入愤怒", () => {
  it("打出后抽牌堆多一张撒泼且进入愤怒", () => {
    const s = combat("watcher");
    const before = s.combat!.drawPile.filter(c => c.defId === "tantrum").length;
    playOnly(s, "tantrum", 0);
    const after = s.combat!.drawPile.filter(c => c.defId === "tantrum").length;
    expect(after).toBe(before + 1);
    expect(s.combat!.playerStance).toBe("wrath");
  });
});

describe("雕琢现实：加一张痛斩进手牌", () => {
  it("打出后手牌含痛斩", () => {
    const s = combat("watcher");
    playOnly(s, "carve_reality", 0);
    expect(s.combat!.hand.some(c => c.defId === "smite")).toBe(true);
  });
});

describe("卡池归属", () => {
  it("新卡进入正确颜色/稀有度池", () => {
    expect(cardPoolOf("green", "common")).toContain("slice");
    expect(cardPoolOf("green", "uncommon")).toContain("dash");
    expect(cardPoolOf("blue", "common")).toContain("leap");
    expect(cardPoolOf("purple", "common")).toContain("empty_fist");
    expect(cardPoolOf("red", "rare")).toContain("impervious");
  });

  it("无色卡不进任何角色奖励池", () => {
    for (const color of ["red", "green", "blue", "purple"] as const) {
      const pool = rewardCardPoolOf(color);
      expect(pool).not.toContain("bandage_up");
      expect(pool).not.toContain("swift_strike");
    }
  });
});

describe("商店贩售无色卡", () => {
  it("商店库存包含至少一张无色卡", () => {
    const s = newRun({ runId: "shop", seed: 5, character: "ironclad" });
    generateShop(s);
    const hasColorless = s.shop!.items.some(
      item => item.kind === "card" && getCardDef(item.defId).color === "colorless",
    );
    expect(hasColorless).toBe(true);
  });
});
