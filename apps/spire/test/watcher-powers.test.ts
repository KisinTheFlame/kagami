import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 既定事实（保留即永久降费）/ 研习（回合末洗入洞悉）。

function combat(): GameState {
  const s = newRun({ runId: "wp", seed: 49, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("既定事实：被保留的牌永久降费", () => {
  it("保留牌回合末 -1 费，跨两回合叠加 -2", () => {
    const s = combat();
    // 挂上既定事实。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "establishment", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "establishment")).toBe(1);
    // 放一张保留牌（坚韧 perseverance 是保留技能）在手里。
    const retainCard: CardInstance = { uid: s.nextUid++, defId: "perseverance", upgraded: false };
    s.combat!.hand = [retainCard];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s); // 回合末保留 → costReduction 1
    expect(retainCard.costReduction).toBe(1);
    // 再过一回合仍在手里被保留 → costReduction 2。
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(retainCard.costReduction).toBe(2);
  });
});

describe("研习：回合末将洞悉加入抽牌堆", () => {
  it("回合结束后抽牌堆多出一张洞悉", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "study", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "study")).toBe(1);
    // 研习在回合末把洞悉洗入抽牌堆；下回合起手抽牌可能把它抽进手里，故统计各堆总量。
    const countInsight = (g: GameState): number =>
      [g.combat!.hand, g.combat!.drawPile, g.combat!.discardPile]
        .flat()
        .filter(c => c.defId === "insight").length;
    const insightBefore = countInsight(s);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(countInsight(s)).toBe(insightBefore + 1);
  });
});
