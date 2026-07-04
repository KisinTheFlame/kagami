import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 深谋远虑（回合末额外保留 N 张）/ 哨戒（被消耗回能量，onExhaust）。

function combat(character: "silent" | "defect"): GameState {
  const s = newRun({ runId: "re", seed: 45, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("深谋远虑：回合结束额外保留 N 张", () => {
  it("保留 1 张：回合末手里两张普通牌，留 1 弃 1", () => {
    const s = combat("silent");
    // 先挂上能力。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "well_laid_plans", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "well_laid_plans")).toBe(1);
    // 回合末手里两张 strike（非保留/非虚无）→ 保留 1、弃 1。
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "defend",
      upgraded: false,
    }));
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 新回合抽 5 张 defend + 保留的 1 张 strike = 手里应有恰好 1 张 strike。
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(1);
  });
});

describe("哨戒：被消耗时回能量", () => {
  it("主动消耗手牌时哨戒回 2 能量", () => {
    const s = combat("defect");
    // 断魂（exhaust_non_attacks）消耗手里所有非攻击牌（哨戒是技能会被消耗）。
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "sever_soul", upgraded: false }, // 断魂：造成伤害并消耗所有非攻击
      { uid: s.nextUid++, defId: "sentinel", upgraded: false },
    ];
    s.combat!.energy = 5;
    const before = s.combat!.energy;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 断魂花 2 费；哨戒被消耗回 2 能量 → 净 -2。
    expect(s.combat!.energy).toBe(before - 2 + 2);
    expect(s.combat!.exhaustPile.some(c => c.defId === "sentinel")).toBe(true);
  });

  it("正常打出（非消耗）不触发 onExhaust", () => {
    const s = combat("defect");
    const card: CardInstance = { uid: s.nextUid++, defId: "sentinel", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 5;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 哨戒不消耗 → 进弃牌堆，不回能量（花 1 费）。
    expect(s.combat!.energy).toBe(4);
    expect(s.combat!.playerBlock).toBe(5);
    expect(s.combat!.discardPile.some(c => c.defId === "sentinel")).toBe(true);
  });
});
