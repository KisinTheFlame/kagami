import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { getCharacterConfig, ALL_CHARACTERS } from "../src/engine/characters/characters.js";
import { generateReward } from "../src/engine/run/run.js";
import { cardPoolOf, rewardCardPoolOf, getCardDef } from "../src/engine/cards/cards.js";

// C1：角色框架——角色配置驱动起始参数，卡池按颜色过滤。

describe("角色配置", () => {
  it("铁甲战士：80 血、红色、燃烧之血起始遗物、10 张起始牌", () => {
    const c = getCharacterConfig("ironclad");
    expect(c.maxHp).toBe(80);
    expect(c.color).toBe("red");
    expect(c.starterRelic).toBe("burning_blood");
    expect(c.starterDeck).toHaveLength(10);
  });

  it("newRun 用角色配置初始化血量/牌组/遗物", () => {
    const s = newRun({ runId: "c", seed: 1, character: "ironclad" });
    expect(s.maxHp).toBe(80);
    expect(s.hp).toBe(80);
    expect(s.deck).toHaveLength(10);
    expect(s.relics[0]!.id).toBe("burning_blood");
    expect(s.character).toBe("ironclad");
  });

  it("未实现角色抛错（守卫栏杆，防止无效角色开局）", () => {
    expect(() => newRun({ runId: "x", seed: 1, character: "defect" })).toThrow();
  });
});

describe("卡池按颜色过滤", () => {
  it("红色卡池非空，且里面每张都是红色", () => {
    const red = rewardCardPoolOf("red");
    expect(red.length).toBeGreaterThan(0);
    for (const id of red) {
      expect(getCardDef(id).color).toBe("red");
    }
  });

  it("蓝/紫色卡池当前为空（机器人/观者未实现）", () => {
    expect(rewardCardPoolOf("blue")).toHaveLength(0);
    expect(rewardCardPoolOf("purple")).toHaveLength(0);
  });

  it("按颜色+稀有度取池：红色各档非空", () => {
    expect(cardPoolOf("red", "common").length).toBeGreaterThan(0);
    expect(cardPoolOf("red", "uncommon").length).toBeGreaterThan(0);
    expect(cardPoolOf("red", "rare").length).toBeGreaterThan(0);
  });

  it("铁甲战士奖励只给红色卡（不含废牌）", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const s = newRun({ runId: `r${seed}`, seed });
      generateReward(s);
      for (const choice of s.reward!.cardChoices) {
        expect(getCardDef(choice.defId).color).toBe("red");
      }
    }
  });
});

describe("已实现角色清单", () => {
  it("铁甲战士 + 静默猎手", () => {
    expect(ALL_CHARACTERS.map(c => c.id).sort()).toEqual(["ironclad", "silent"]);
  });
});
