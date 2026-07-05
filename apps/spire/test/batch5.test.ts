import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 十卡批次5：炼金/混乱/嬗变/烈焰吐息/增幅/创意AI/回响形态/评估/追击/冥想。

function combat(character: "silent" | "ironclad" | "defect" | "watcher"): GameState {
  const s = newRun({ runId: "bt5", seed: 61, character });
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

describe("炼金：获得随机药水", () => {
  it("空槽填入一瓶药水", () => {
    const s = combat("silent");
    s.potions = [null, null, null];
    play(s, "alchemize", null);
    expect(s.potions.filter(p => p !== null)).toHaveLength(1);
  });
});

describe("混乱：回合始打出牌堆顶", () => {
  it("挂上后新回合自动打出顶部打击造成伤害", () => {
    const s = combat("watcher");
    play(s, "mayhem", null);
    expect(getPower(s.combat!.playerPowers, "mayhem")).toBe(1);
    s.combat!.enemies[0]!.block = 0;
    // 抽牌堆放足量 strike，使起手抽 5 后仍有剩余，混乱再打出顶部一张。
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    const before = s.combat!.enemies[0]!.hp;
    endTurn(s);
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(6);
  });
});

describe("嬗变：X 张随机无色免费牌", () => {
  it("X=3 → 手里多 3 张 costZero 无色牌", () => {
    const s = combat("watcher");
    const card: CardInstance = { uid: s.nextUid++, defId: "transmutation", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    const added = s.combat!.hand.filter(c => c.costZero);
    expect(added).toHaveLength(3);
    expect(added.every(c => getCardDef(c.defId).color === "colorless")).toBe(true);
  });
});

describe("烈焰吐息：抽到状态/诅咒打全体", () => {
  it("抽到伤口 → 全体受伤害", () => {
    const s = combat("ironclad");
    play(s, "fire_breathing", null);
    expect(getPower(s.combat!.playerPowers, "fire_breathing")).toBe(6);
    s.combat!.enemies[0]!.block = 0;
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "wound", upgraded: false }];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "pommel_strike", 0); // 抽 1 → 抽到 wound（状态牌）→ 烈焰吐息 6
    expect(before - s.combat!.enemies[0]!.hp).toBeGreaterThanOrEqual(6);
  });
});

describe("增幅：下一张能力牌翻倍", () => {
  it("增幅后打出恶魔形态，力量 +2×2", () => {
    const s = combat("ironclad");
    play(s, "amplify", null);
    expect(getPower(s.combat!.playerPowers, "amplify")).toBe(1);
    play(s, "demon_form", null); // 恶魔形态 apply demon_form 2；增幅再结算一次 → demon_form 4
    expect(getPower(s.combat!.playerPowers, "demon_form")).toBe(4);
  });
});

describe("创意AI：回合始加随机能力牌", () => {
  it("挂上后新回合手里多一张能力牌", () => {
    const s = combat("defect");
    play(s, "creative_ai", null);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    const powers = s.combat!.hand.filter(c => getCardDef(c.defId).type === "power");
    expect(powers.length).toBeGreaterThanOrEqual(1);
  });
});

describe("回响形态：每回合第一张牌翻倍", () => {
  it("第一张打击造成双倍", () => {
    const s = combat("defect");
    play(s, "echo_form", null);
    // echo_form 打出后 cardsPlayedThisTurn 已是 1（它是第一张），但 echoBefore=0 不翻倍自身。
    // 新回合第一张 strike 应翻倍。
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    s.combat!.enemies[0]!.block = 0;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0); // 第一张 → 6×2 = 12
    expect(before - s.combat!.enemies[0]!.hp).toBe(12);
  });
});

describe("评估：格挡 + 洗入洞悉", () => {
  it("获得 6 格挡且抽牌堆多一张洞悉", () => {
    const s = combat("watcher");
    s.combat!.playerBlock = 0;
    s.combat!.drawPile = [];
    play(s, "evaluate", null);
    expect(s.combat!.playerBlock).toBe(6);
    expect(s.combat!.drawPile.some(c => c.defId === "insight")).toBe(true);
  });
});

describe("追击：上张是攻击则回能量", () => {
  it("上张是攻击 → follow_up 回 1 能量（净费 0）", () => {
    const s = combat("watcher");
    s.combat!.enemies[0]!.block = 0;
    s.combat!.lastCardType = "attack";
    s.combat!.hand = [{ uid: s.nextUid++, defId: "follow_up", upgraded: false }];
    s.combat!.energy = 1;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(1); // -1 费 +1 回。
  });

  it("上张不是攻击 → 不回能量", () => {
    const s = combat("watcher");
    s.combat!.enemies[0]!.block = 0;
    s.combat!.lastCardType = "skill";
    s.combat!.hand = [{ uid: s.nextUid++, defId: "follow_up", upgraded: false }];
    s.combat!.energy = 1;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
  });
});

describe("冥想：取回 + 平静 + 结束回合", () => {
  it("取回弃牌，进平静，回合推进", () => {
    const s = combat("watcher");
    s.combat!.discardPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    const turnBefore = s.combat!.turn;
    const card: CardInstance = { uid: s.nextUid++, defId: "meditate", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    s.combat!.enemies[0]!.currentMove = "incantation";
    expect(playCard(s, 0, null).ok).toBe(true);
    // 取回 strike + 进平静 + 结束回合（回合推进）。
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.turn).toBe(turnBefore + 1);
  });
});
