import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 最后 8 卡：雷霆一击/一心一意/布置/灼烧打击/噩梦/采集/宝库/削刮。

function combat(character: "defect" | "silent" | "watcher" | "ironclad"): GameState {
  const s = newRun({ runId: "bt3", seed: 59, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  if (character === "defect") {
    s.combat!.orbs = [];
    s.combat!.orbSlots = 10;
  }
  return s;
}

function play(s: GameState, defId: string, target: number | null, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("雷霆一击：按本场充能闪电数打击", () => {
  it("充过 3 闪电 → 3 次 7 伤（单敌共 21）", () => {
    const s = combat("defect");
    s.combat!.lightningChanneledThisCombat = 3;
    s.combat!.enemies[0]!.block = 0;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "thunder_strike", null);
    expect(before - s.combat!.enemies[0]!.hp).toBe(21);
  });
});

describe("一心一意：收回弃牌堆 0 费牌", () => {
  it("弃牌堆的 0 费牌被收回手牌", () => {
    const s = combat("defect");
    s.combat!.enemies[0]!.block = 0;
    s.combat!.discardPile = [
      { uid: s.nextUid++, defId: "shiv", upgraded: false }, // shiv 0 费
      { uid: s.nextUid++, defId: "strike", upgraded: false }, // 非 0 费
    ];
    play(s, "all_for_one", 0);
    expect(s.combat!.hand.some(c => c.defId === "shiv")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "shiv")).toBe(false);
  });
});

describe("布置：手牌置顶且变 0 费", () => {
  it("最贵手牌被置于抽牌堆顶且 costZero", () => {
    const s = combat("silent");
    s.combat!.drawPile = [];
    const card: CardInstance = { uid: s.nextUid++, defId: "setup", upgraded: false };
    const expensive: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [card, expensive];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    const top = s.combat!.drawPile[s.combat!.drawPile.length - 1];
    expect(top?.defId).toBe("defend");
    expect(top?.costZero).toBe(true);
  });
});

describe("噩梦：下回合加 3 张副本", () => {
  it("指定手牌，下回合起手多 3 张副本", () => {
    const s = combat("silent");
    const target: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    const card: CardInstance = { uid: s.nextUid++, defId: "nightmare", upgraded: false };
    s.combat!.hand = [card, target];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.nightmarePending?.cardId).toBe("strike");
    s.combat!.hand = [];
    // 抽牌堆用 defend 填充，避免起手抽到 strike 干扰计数。
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "defend",
      upgraded: false,
    }));
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand.filter(c => c.defId === "strike").length).toBe(3);
  });
});

describe("采集：接下来 X 回合各加洞悉", () => {
  it("X=2 → 下回合起手有洞悉，采集层数递减", () => {
    const s = combat("watcher");
    const card: CardInstance = { uid: s.nextUid++, defId: "collect", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 2;
    expect(playCard(s, 0, null).ok).toBe(true);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand.some(c => c.defId === "insight" && c.costZero)).toBe(true);
  });
});

describe("宝库：额外回合（敌人不行动）", () => {
  it("结束回合后敌人不攻击，回合再次推进", () => {
    const s = combat("watcher");
    s.hp = 100;
    play(s, "vault", null);
    expect(s.combat!.extraTurnPending).toBe(true);
    const turnBefore = s.combat!.turn;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 敌人本想攻击
    const hpBefore = s.hp;
    endTurn(s);
    // 额外回合：敌人被跳过，玩家没掉血；回合推进。
    expect(s.hp).toBe(hpBefore);
    expect(s.combat!.turn).toBe(turnBefore + 1);
    expect(s.combat!.extraTurnPending).toBe(false);
  });
});

describe("削刮：抽 5 只留 0 费", () => {
  it("抽到的非 0 费牌被弃掉", () => {
    const s = combat("defect");
    s.combat!.enemies[0]!.block = 0;
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "shiv", upgraded: false }, // 0 费
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    const card: CardInstance = { uid: s.nextUid++, defId: "scrape", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 抽的 5 张里只有 shiv 是 0 费 → 手里留 shiv，其余进弃牌堆。
    expect(s.combat!.hand.some(c => c.defId === "shiv")).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "strike").length).toBe(0);
  });
});

describe("灼烧打击：普通攻击", () => {
  it("造成 12 点", () => {
    const s = combat("ironclad");
    s.combat!.enemies[0]!.block = 0;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "searing_blow", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 12);
    void getCardDef;
  });
});
