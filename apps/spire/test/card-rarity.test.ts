import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { generateReward } from "../src/engine/run/run.js";
import {
  COMMON_CARD_POOL,
  UNCOMMON_CARD_POOL,
  RARE_CARD_POOL,
  getCardDef,
} from "../src/engine/cards/cards.js";

// A2：卡稀有度系统 + 奖励按稀有度加权。

describe("稀有度分池", () => {
  it("三档池非空、互不相交、不含起始/特殊", () => {
    const all = [...COMMON_CARD_POOL, ...UNCOMMON_CARD_POOL, ...RARE_CARD_POOL];
    expect(COMMON_CARD_POOL.length).toBeGreaterThan(0);
    expect(UNCOMMON_CARD_POOL.length).toBeGreaterThan(0);
    expect(RARE_CARD_POOL.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length); // 无重复
    for (const id of all) {
      const r = getCardDef(id).rarity;
      expect(["common", "uncommon", "rare"]).toContain(r);
    }
  });

  it("新稀有卡 献焰/献祭 归入稀有池", () => {
    expect(RARE_CARD_POOL).toContain("immolate");
    expect(RARE_CARD_POOL).toContain("offering");
  });

  it("每档池里的卡稀有度自洽", () => {
    for (const id of COMMON_CARD_POOL) expect(getCardDef(id).rarity).toBe("common");
    for (const id of UNCOMMON_CARD_POOL) expect(getCardDef(id).rarity).toBe("uncommon");
    for (const id of RARE_CARD_POOL) expect(getCardDef(id).rarity).toBe("rare");
  });
});

describe("奖励按稀有度加权", () => {
  it("永远给 3 张不重复、不含起始/特殊的卡", () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const s = newRun({ runId: `r${seed}`, seed });
      generateReward(s);
      const choices = s.reward!.cardChoices;
      expect(choices).toHaveLength(3);
      expect(new Set(choices.map(c => c.defId)).size).toBe(3);
      for (const c of choices) {
        const r = getCardDef(c.defId).rarity;
        expect(["common", "uncommon", "rare"]).toContain(r);
      }
    }
  });

  it("分布偏向普通：普通 > 罕见 > 稀有，且稀有确实会出现", () => {
    const counts = { common: 0, uncommon: 0, rare: 0 };
    for (let seed = 0; seed < 800; seed += 1) {
      const s = newRun({ runId: `d${seed}`, seed });
      generateReward(s);
      for (const c of s.reward!.cardChoices) {
        const r = getCardDef(c.defId).rarity as "common" | "uncommon" | "rare";
        counts[r] += 1;
      }
    }
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(0);
  });
});
