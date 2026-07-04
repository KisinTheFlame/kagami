import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 静默 / 观者工具牌：行业工具 / 钢铁风暴 / 挥手。

function combat(character: GameState["character"] = "silent", encounter = "cultist"): GameState {
  const s = newRun({ runId: "ub", seed: 28, character });
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  for (const e of s.combat!.enemies) {
    e.hp = 300;
    e.maxHp = 300;
  }
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("行业工具：回合始抽 1 弃 1", () => {
  it("新回合抽牌并随机弃牌（手牌净变化 0，但发生了抽/弃）", () => {
    const s = combat();
    play(s, "tools_of_the_trade", null);
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.discardPile = [];
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 起手抽 5 + 工具抽 1 - 工具弃 1 = 5 张手牌，且弃牌堆多了 1 张。
    expect(s.combat!.hand).toHaveLength(5);
    expect(s.combat!.discardPile.length).toBeGreaterThanOrEqual(1);
  });
});

describe("钢铁风暴：弃手牌换飞刀", () => {
  it("弃掉 N 张手牌，换来 N 张飞刀", () => {
    const s = combat();
    // 钢铁风暴 + 3 张其它 → 打出后剩 3 张 → 弃 3 换 3 飞刀。
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "storm_of_steel", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "shiv")).toHaveLength(3);
    expect(s.combat!.hand.every(c => c.defId === "shiv")).toBe(true);
  });
});

describe("挥手：获得格挡时全体虚弱", () => {
  it("持有挥手时获得格挡 → 敌人叠虚弱", () => {
    const s = combat("watcher", "two_fungi_beasts");
    play(s, "wave_of_the_hand", null); // 挥手本身不加格挡
    play(s, "defend", null); // 获得 5 格挡 → 触发挥手
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "weak")).toBeGreaterThanOrEqual(1);
    }
  });

  it("回合结束后挥手清除", () => {
    const s = combat("watcher");
    play(s, "wave_of_the_hand", null);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "wave_of_the_hand")).toBe(0);
  });
});
