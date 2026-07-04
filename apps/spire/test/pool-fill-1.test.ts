import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 卡池填充批次 1：致残云/千疮百孔/催化剂/无尽之刃/高能光束/超频/弹幕/空心/保龄冲击/谋略大师。

function combat(character: GameState["character"] = "silent", encounter = "cultist"): GameState {
  const s = newRun({ runId: "pf1", seed: 16, character });
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  for (const e of s.combat!.enemies) {
    e.hp = 300;
    e.maxHp = 300;
    e.block = 0;
  }
  if (s.combat!.orbs) s.combat!.orbs = [];
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("静默填充", () => {
  it("致残云：全体中毒 + 虚弱", () => {
    const s = combat("silent", "two_fungi_beasts");
    play(s, "crippling_cloud", null);
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "poison")).toBe(4);
      expect(getPower(e.powers, "weak")).toBe(2);
    }
  });

  it("千疮百孔：3×5 = 15", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    play(s, "riddle_with_holes", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 15);
  });

  it("催化剂：目标中毒翻倍", () => {
    const s = combat();
    s.combat!.enemies[0]!.powers.push({ id: "poison", amount: 5 });
    play(s, "catalyst", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBe(10);
  });

  it("无尽之刃：回合开始加飞刀", () => {
    const s = combat();
    play(s, "infinite_blades", null);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand.some(c => c.defId === "shiv")).toBe(true);
  });
});

describe("机器人填充", () => {
  it("高能光束：全体 26 伤 + 失 3 集中", () => {
    const s = combat("defect", "two_fungi_beasts");
    const before = s.combat!.enemies[0]!.hp;
    play(s, "hyperbeam", null);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 26);
    expect(getPower(s.combat!.playerPowers, "focus")).toBe(-3);
  });

  it("超频：抽 2 + 弃牌堆加灼烧", () => {
    const s = combat("defect");
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    play(s, "overclock", null);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(2);
    expect(s.combat!.discardPile.some(c => c.defId === "burn")).toBe(true);
  });

  it("弹幕：每颗球一击", () => {
    const s = combat("defect");
    s.combat!.orbs = [{ type: "lightning" }, { type: "frost" }, { type: "lightning" }];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "barrage", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 12); // 3 球 ×4
  });
});

describe("观者 / 无色填充", () => {
  it("空心：退姿态 + 抽牌", () => {
    const s = combat("watcher");
    s.combat!.playerStance = "wrath";
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    play(s, "empty_mind", null);
    expect(s.combat!.playerStance).toBe("none");
    expect(s.combat!.hand.filter(c => c.defId === "strike").length).toBeGreaterThanOrEqual(2);
  });

  it("保龄冲击：按敌人数 ×7", () => {
    const s = combat("watcher", "two_fungi_beasts");
    const before = s.combat!.enemies[0]!.hp;
    play(s, "bowling_bash", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 14); // 2 敌 ×7
  });

  it("谋略大师：抽 3", () => {
    const s = combat("ironclad");
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    play(s, "master_of_strategy", null);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(3);
  });
});

describe("卡池归属", () => {
  it("填充卡进入正确池", () => {
    expect(cardPoolOf("green", "uncommon")).toContain("catalyst");
    expect(cardPoolOf("blue", "rare")).toContain("hyperbeam");
    expect(cardPoolOf("blue", "common")).toContain("barrage");
    expect(cardPoolOf("purple", "common")).toContain("bowling_bash");
  });
});
