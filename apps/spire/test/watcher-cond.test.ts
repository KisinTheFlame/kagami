import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 观者条件牌：神圣 / 义愤 / 内心平静。

function combat(encounter = "cultist"): GameState {
  const s = newRun({ runId: "wc", seed: 29, character: "watcher" });
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

describe("神圣：上一张是技能则抽牌", () => {
  it("上一张为技能 → 抽 2", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    play(s, "defend", null); // 技能，设 lastCardType=skill
    s.combat!.playerBlock = 0;
    const handBefore = s.combat!.hand.length;
    play(s, "sanctity", null);
    expect(s.combat!.playerBlock).toBe(6);
    // 打出 sanctity 后（sanctity 自身离手），抽了 2 张。
    expect(s.combat!.hand.length).toBeGreaterThan(handBefore);
  });

  it("上一张为攻击 → 不抽", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    play(s, "strike", 0); // 攻击
    s.combat!.playerBlock = 0;
    play(s, "sanctity", null);
    expect(s.combat!.playerBlock).toBe(6);
    expect(s.combat!.hand).toHaveLength(0); // sanctity 离手、未抽牌
  });
});

describe("义愤", () => {
  it("非愤怒 → 进入愤怒", () => {
    const s = combat();
    s.combat!.playerStance = "none";
    play(s, "indignation", null);
    expect(s.combat!.playerStance).toBe("wrath");
  });

  it("愤怒 → 全体易伤", () => {
    const s = combat("two_fungi_beasts");
    s.combat!.playerStance = "wrath";
    play(s, "indignation", null);
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "vulnerable")).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("内心平静", () => {
  it("非平静 → 进入平静", () => {
    const s = combat();
    s.combat!.playerStance = "none";
    play(s, "inner_peace", null);
    expect(s.combat!.playerStance).toBe("calm");
  });

  it("平静 → 抽 3", () => {
    const s = combat();
    s.combat!.playerStance = "calm";
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [{ uid: s.nextUid++, defId: "inner_peace", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(3);
  });
});
