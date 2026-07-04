import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 条件伤害 / 击杀返能 / 受击加甲：大结局 / 全力打击 / 分裂 / 痛打。

function combat(character: GameState["character"] = "silent", encounter = "cultist"): GameState {
  const s = newRun({ runId: "cb", seed: 24, character });
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  for (const e of s.combat!.enemies) {
    e.hp = 300;
    e.maxHp = 300;
    e.block = 0;
  }
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("大结局：抽牌堆空才发挥", () => {
  it("抽牌堆空 → 全体 50", () => {
    const s = combat("silent", "two_fungi_beasts");
    s.combat!.drawPile = [];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "grand_finale", null);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 50);
  });

  it("抽牌堆非空 → 无伤害", () => {
    const s = combat();
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "grand_finale", null);
    expect(s.combat!.enemies[0]!.hp).toBe(before);
  });
});

describe("全力打击：全体 + 弃牌", () => {
  it("对全体造成伤害", () => {
    const s = combat("silent", "two_fungi_beasts");
    const before = s.combat!.enemies[0]!.hp;
    play(s, "all_out_attack", null);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 10);
  });
});

describe("分裂：击杀返能", () => {
  it("击杀目标 → +3 能量", () => {
    const s = combat("defect", "two_fungi_beasts");
    s.combat!.enemies[0]!.hp = 5;
    s.combat!.enemies[1]!.hp = 100;
    play(s, "sunder", 0, 3);
    expect(s.combat!.energy).toBe(3); // 3 - 3(费) + 3(击杀)
  });

  it("未击杀不返能", () => {
    const s = combat("defect");
    s.combat!.enemies[0]!.hp = 100;
    play(s, "sunder", 0, 3);
    expect(s.combat!.energy).toBe(0);
  });
});

describe("痛打：造成伤害并等量加甲", () => {
  it("获得等同实际造成伤害的格挡", () => {
    const s = combat("watcher");
    s.combat!.playerBlock = 0;
    play(s, "wallop", 0);
    expect(s.combat!.playerBlock).toBe(9);
  });

  it("目标有格挡时按实际穿透加甲", () => {
    const s = combat("watcher");
    s.combat!.enemies[0]!.block = 4;
    s.combat!.playerBlock = 0;
    play(s, "wallop", 0);
    expect(s.combat!.playerBlock).toBe(5); // 9 伤 - 4 格挡 = 5 实际穿透
  });
});
