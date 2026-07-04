import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 磁力（回合始随机加无色牌）/ 顿悟（本回合手牌费用降至 1）。

function combat(character: "defect" | "watcher"): GameState {
  const s = newRun({ runId: "gen", seed: 56, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("磁力：每回合开始随机加入 1 张无色牌", () => {
  it("挂上后新回合手里多一张无色牌", () => {
    const s = combat("defect");
    s.combat!.hand = [{ uid: s.nextUid++, defId: "magnetism", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "magnetism")).toBe(1);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 新回合手牌里应有恰好 1 张无色牌（磁力加的）。
    const colorless = s.combat!.hand.filter(c => getCardDef(c.defId).color === "colorless");
    expect(colorless).toHaveLength(1);
  });
});

describe("顿悟：本回合手牌费用降至 1", () => {
  it("高费牌打出时费用被压到 1", () => {
    const s = combat("watcher");
    // 手里放一张贵牌（祈愿费 3）+ 顿悟。
    const wish: CardInstance = { uid: s.nextUid++, defId: "wish", upgraded: false };
    s.combat!.hand = [{ uid: s.nextUid++, defId: "enlightenment", upgraded: false }, wish];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true); // 打顿悟
    expect(wish.costCapThisTurn).toBe(1);
    // 祈愿现在只需 1 费。
    s.combat!.hand = [wish];
    s.combat!.energy = 1;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
  });

  it("回合结束清除费用上限", () => {
    const s = combat("watcher");
    const wish: CardInstance = { uid: s.nextUid++, defId: "wish", upgraded: false };
    wish.costCapThisTurn = 1;
    s.combat!.hand = [wish];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(wish.costCapThisTurn).toBeUndefined();
  });
});
