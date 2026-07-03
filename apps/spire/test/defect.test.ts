import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCharacterConfig } from "../src/engine/characters/characters.js";
import { generateReward } from "../src/engine/run/run.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// C3：故障机器人——充能球子系统（充能/唤醒/回合末被动）+ 闪电/冰霜 + 集中。

function defectCombat(encounter = "cultist"): GameState {
  const s = newRun({ runId: "defect", seed: 1, character: "defect" });
  startCombat(s, encounter);
  s.hp = 200;
  s.maxHp = 200;
  s.combat!.enemies[0]!.hp = 100;
  s.combat!.enemies[0]!.maxHp = 100;
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("机器人配置 + 残破核心", () => {
  it("75 血、蓝色、残破核心、3 球槽、开局 1 颗闪电球", () => {
    const c = getCharacterConfig("defect");
    expect(c.maxHp).toBe(75);
    expect(c.color).toBe("blue");
    const s = defectCombat();
    expect(s.combat!.orbSlots).toBe(3);
    expect(s.combat!.orbs).toEqual([{ type: "lightning" }]); // 残破核心
  });
});

describe("充能与被动", () => {
  it("电击充能 1 颗闪电球", () => {
    const s = defectCombat();
    s.combat!.orbs = [];
    play(s, "zap");
    expect(s.combat!.orbs).toEqual([{ type: "lightning" }]);
  });

  it("闪电球回合末被动：对随机敌人造成 3", () => {
    const s = defectCombat(); // 已有 1 闪电球
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation"; // 敌人不攻击
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBe(97); // 闪电被动 3
  });

  it("冰霜球回合末被动：获得 2 格挡", () => {
    const s = defectCombat();
    s.combat!.orbs = [{ type: "frost" }];
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 回合末冰霜给 2 格挡（新回合开始前）——通过下一回合开始清零前不可见，
    // 改为验证：敌人不攻击、玩家格挡在回合末确实加过（用暗袭测吸收）
    const s2 = defectCombat();
    s2.combat!.orbs = [{ type: "frost" }];
    s2.hp = 100;
    s2.combat!.hand = [];
    s2.combat!.enemies[0]!.currentMove = "dark_strike"; // 暗袭 6
    endTurn(s2);
    expect(s2.hp).toBe(96); // 冰霜 2 格挡吸掉 2，剩 4 穿透
  });
});

describe("唤醒", () => {
  it("双重施法唤醒最左侧闪电球：造成 8 并移除该球", () => {
    const s = defectCombat(); // 1 闪电球
    play(s, "dualcast", null);
    expect(s.combat!.enemies[0]!.hp).toBe(92); // 唤醒 8
    expect(s.combat!.orbs).toHaveLength(0);
  });

  it("球槽满时充能会先唤醒最左侧球", () => {
    const s = defectCombat();
    s.combat!.orbs = [{ type: "lightning" }, { type: "lightning" }, { type: "lightning" }]; // 满 3
    const hp0 = s.combat!.enemies[0]!.hp;
    play(s, "zap"); // 第 4 颗 → 先唤醒最左(闪电8)，再放新球
    expect(s.combat!.enemies[0]!.hp).toBe(hp0 - 8);
    expect(s.combat!.orbs).toHaveLength(3);
  });
});

describe("集中", () => {
  it("碎片整理 +1 集中 → 闪电被动变 4", () => {
    const s = defectCombat();
    play(s, "defragment", null);
    s.combat!.orbs = [{ type: "lightning" }];
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBe(96); // (3+1) 被动
  });
});

describe("蓝色卡池", () => {
  it("机器人奖励只给蓝色卡", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const s = newRun({ runId: `b${seed}`, seed, character: "defect" });
      generateReward(s);
      for (const choice of s.reward!.cardChoices) {
        expect(getCardDef(choice.defId).color).toBe("blue");
      }
    }
  });
});
