import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { rewardCardPoolOf, getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 诅咒牌系统 + 无色填充。

function combat(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "cc", seed: 21, character });
  startCombat(s, "cultist");
  s.hp = 200;
  s.maxHp = 200;
  s.combat!.enemies[0]!.hp = 200;
  s.combat!.enemies[0]!.maxHp = 200;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("诅咒牌", () => {
  it("诅咒不进任何角色奖励池", () => {
    for (const color of ["red", "green", "blue", "purple"] as const) {
      const pool = rewardCardPoolOf(color);
      for (const id of ["injury", "decay", "doubt", "parasite"]) {
        expect(pool).not.toContain(id);
      }
    }
  });

  it("诅咒无法打出", () => {
    const s = combat();
    const card: CardInstance = { uid: s.nextUid++, defId: "injury", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(false);
  });

  it("腐朽：回合结束在手失 2 血", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "decay", upgraded: false }];
    s.combat!.enemies[0]!.currentMove = "incantation";
    const before = s.hp;
    endTurn(s);
    expect(s.hp).toBe(before - 2);
  });

  it("疑虑：回合结束在手施加虚弱（衰减后仍在）", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "doubt", upgraded: false }];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "weak")).toBeGreaterThanOrEqual(1);
  });

  it("蠕动：固有诅咒开局在手", () => {
    const s = newRun({ runId: "writhe", seed: 2, character: "ironclad" });
    s.deck.push({ uid: s.nextUid++, defId: "writhe", upgraded: false });
    startCombat(s, "cultist");
    expect(s.combat!.hand.some(c => c.defId === "writhe")).toBe(true);
  });

  it("诅咒是 curse 类型/颜色", () => {
    const def = getCardDef("decay");
    expect(def.type).toBe("curse");
    expect(def.color).toBe("curse");
  });
});

describe("无色填充", () => {
  it("深呼吸：把弃牌堆洗入抽牌堆", () => {
    const s = combat();
    s.combat!.discardPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.drawPile = [];
    play(s, "deep_breath", null);
    // 5 张 strike 从弃牌堆洗入抽牌堆（deep_breath 自身随后进弃牌堆）。
    expect(s.combat!.discardPile.some(c => c.defId === "strike")).toBe(false);
    expect(s.combat!.drawPile.filter(c => c.defId === "strike").length).toBeGreaterThanOrEqual(4);
  });

  it("撕咬：造成伤害并回血", () => {
    const s = combat();
    s.hp = 50;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "bite", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 7);
    expect(s.hp).toBe(52);
  });

  it("杰克斯：失血换力量", () => {
    const s = combat();
    s.hp = 50;
    play(s, "jax", null);
    expect(s.hp).toBe(47);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
  });

  it("幻影：获得虚无缥缈", () => {
    const s = combat();
    play(s, "apparition", null);
    expect(getPower(s.combat!.playerPowers, "intangible")).toBe(1);
  });
});
