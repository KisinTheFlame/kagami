import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 掌控现实（生成牌即升级）/ 研学有成（击杀则升级牌组一张）。

function combat(): GameState {
  const s = newRun({ runId: "mr", seed: 51, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("掌控现实：生成的牌进场即升级", () => {
  it("挂上后洗入的洞悉是升级版", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "master_reality", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "master_reality")).toBe(1);
    // 用「阿尔法」生成贝塔（走 addCards）；掌控现实下贝塔应进场即升级。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "alpha", upgraded: false }];
    s.combat!.drawPile = [];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    const beta = s.combat!.drawPile.find(c => c.defId === "beta");
    expect(beta?.upgraded).toBe(true);
  });
});

describe("研学有成：击杀则升级牌组一张", () => {
  it("击杀敌人后牌组多一张升级牌", () => {
    const s = combat();
    // 保证牌组里有未升级牌。
    const upgradedBefore = s.deck.filter(c => c.upgraded).length;
    s.combat!.enemies[0]!.hp = 5;
    s.combat!.enemies[0]!.block = 0;
    const card: CardInstance = { uid: s.nextUid++, defId: "lesson_learned", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 唯一敌人被击杀 → 战斗结束（combat 归 null）；牌组升级持久留在 state.deck。
    expect(s.deck.filter(c => c.upgraded).length).toBe(upgradedBefore + 1);
  });

  it("未击杀则不升级牌组", () => {
    const s = combat();
    const upgradedBefore = s.deck.filter(c => c.upgraded).length;
    s.combat!.enemies[0]!.hp = 100;
    const card: CardInstance = { uid: s.nextUid++, defId: "lesson_learned", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.deck.filter(c => c.upgraded).length).toBe(upgradedBefore);
  });
});
