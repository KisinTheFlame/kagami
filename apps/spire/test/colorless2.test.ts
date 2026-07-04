import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 无色收尾：疯狂（单卡免费）/ 未雨绸缪（手牌置顶）/ 暴力（检索3攻击）/ 发现。

function combat(): GameState {
  const s = newRun({ runId: "cl2", seed: 26, character: "ironclad" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("疯狂：单卡本场免费", () => {
  it("随机使一张手牌 costZero，之后 0 能量可打", () => {
    const s = combat();
    const target: CardInstance = { uid: s.nextUid++, defId: "bash", upgraded: false }; // 痛击本费 2
    s.combat!.hand = [{ uid: s.nextUid++, defId: "madness", upgraded: false }, target];
    s.combat!.energy = 1;
    expect(playCard(s, 0, null).ok).toBe(true); // 打疯狂（费 1）
    expect(target.costZero).toBe(true);
    // 现在痛击费视为 0，0 能量也能打。
    s.combat!.energy = 0;
    const idx = s.combat!.hand.findIndex(c => c.uid === target.uid);
    expect(playCard(s, idx, 0).ok).toBe(true);
  });
});

describe("未雨绸缪：抽 2 + 手牌置顶", () => {
  it("抽牌并把一张手牌放到抽牌堆顶", () => {
    const s = combat();
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.hand = [{ uid: s.nextUid++, defId: "thinking_ahead", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 抽 2 后有牌被置于抽牌堆顶（抽牌堆非空）。
    expect(s.combat!.drawPile.length).toBeGreaterThan(0);
  });
});

describe("暴力：检索 3 张攻击", () => {
  it("从抽牌堆把攻击牌捞进手牌", () => {
    const s = combat();
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "bash", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.hand = [{ uid: s.nextUid++, defId: "violence", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    const attacksInHand = s.combat!.hand.filter(c => getCardDef(c.defId).type === "attack").length;
    expect(attacksInHand).toBe(3);
    expect(s.combat!.drawPile.some(c => c.defId === "defend")).toBe(true); // 防御留在抽牌堆
  });
});

describe("发现：随机无色卡", () => {
  it("加入一张无色卡", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "discovery", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand).toHaveLength(1);
    expect(getCardDef(s.combat!.hand[0]!.defId).color).toBe("colorless");
  });
});
