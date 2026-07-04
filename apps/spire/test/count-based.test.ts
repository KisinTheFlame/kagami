import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 按数量结算：伤害 / 格挡随抽牌堆 / 手牌 / 中毒 / 打击名牌数动态计算。

function combat(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "cnt", seed: 9, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

/** 把某张牌放到手牌首位并打出（不清其余手牌，用于计数场景）。 */
function playWithHand(
  s: GameState,
  defId: string,
  extraHand: string[],
  target: number | null = 0,
): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  const extras = extraHand.map(id => ({ uid: s.nextUid++, defId: id, upgraded: false }));
  s.combat!.hand = [card, ...extras];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("心灵冲击：= 抽牌堆张数", () => {
  it("造成等于抽牌堆张数的伤害", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 7 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    const before = s.combat!.enemies[0]!.hp;
    playWithHand(s, "mind_blast", [], 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 7);
  });
});

describe("灵盾：每张手牌加格挡", () => {
  it("打出后按剩余手牌数 ×amount 加格挡", () => {
    const s = combat("watcher");
    s.combat!.playerBlock = 0;
    // 灵盾 + 3 张其它手牌 → 打出灵盾后剩 3 张 → 3×3=9。
    playWithHand(s, "spirit_shield", ["strike", "strike", "defend"], null);
    expect(s.combat!.playerBlock).toBe(9);
  });
});

describe("飞镖：每张技能牌一击", () => {
  it("手牌中每张技能对目标造成 amount 伤害", () => {
    const s = combat("silent");
    const before = s.combat!.enemies[0]!.hp;
    // 飞镖 + 2 技能(defend/survivor) + 1 攻击(strike) → 打出后手牌 2 技能 → 4×2=8。
    playWithHand(s, "flechettes", ["defend", "survivor", "strike"], 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 8);
  });
});

describe("完美打击：每张「打击」名牌加伤", () => {
  it("基础 + per × 各区打击名牌数", () => {
    const s = combat();
    // 抽牌堆放 3 张 strike，手牌打出完美打击。基础 6 + 2×3 = 12。
    s.combat!.drawPile = Array.from({ length: 3 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    const before = s.combat!.enemies[0]!.hp;
    playWithHand(s, "perfected_strike", [], 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 12);
  });
});

describe("剧毒之刃：中毒则双击", () => {
  it("目标未中毒只造成一次", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    playWithHand(s, "bane", [], 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 7);
  });

  it("目标中毒则造成两次", () => {
    const s = combat();
    s.combat!.enemies[0]!.powers.push({ id: "poison", amount: 3 });
    const before = s.combat!.enemies[0]!.hp;
    playWithHand(s, "bane", [], 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 14);
  });
});

describe("卡池归属", () => {
  it("按数量牌进入正确池", () => {
    expect(cardPoolOf("red", "common")).toContain("perfected_strike");
    expect(cardPoolOf("green", "common")).toContain("flechettes");
    expect(cardPoolOf("green", "common")).toContain("bane");
    expect(cardPoolOf("purple", "rare")).toContain("spirit_shield");
  });
});
