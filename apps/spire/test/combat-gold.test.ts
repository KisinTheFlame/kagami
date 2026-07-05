import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { generateReward } from "../src/engine/run/run.js";
import type { CardInstance } from "../src/engine/types.js";

// 战斗胜利掉金币：普通 10-20 / 精英 25-35 / 首领 ~100。

describe("普通/精英战斗奖励金币", () => {
  it("普通战斗胜利掉 10-20 金", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const s = newRun({ runId: `n${seed}`, seed });
      s.gold = 0;
      s.pendingRelicReward = false;
      generateReward(s);
      expect(s.gold).toBeGreaterThanOrEqual(10);
      expect(s.gold).toBeLessThanOrEqual(20);
    }
  });

  it("精英战斗胜利掉 25-35 金（并发遗物）", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const s = newRun({ runId: `e${seed}`, seed });
      s.gold = 0;
      s.pendingRelicReward = true; // 精英
      const relicsBefore = s.relics.length;
      generateReward(s);
      expect(s.gold).toBeGreaterThanOrEqual(25);
      expect(s.gold).toBeLessThanOrEqual(35);
      expect(s.relics.length).toBeGreaterThanOrEqual(relicsBefore); // 遗物或兜底
    }
  });
});

describe("首领奖励金币", () => {
  it("击败首领掉 ~100 金（95-105）", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const s = newRun({ runId: `b${seed}`, seed });
      startCombat(s, "guardian");
      s.hp = 9999;
      s.maxHp = 9999;
      s.gold = 0;
      // 秒杀首领：塞一张巨伤牌反复打（守卫者 240 血，用 bludgeon×若干）
      s.combat!.enemies[0]!.hp = 1;
      const card: CardInstance = { uid: s.nextUid++, defId: "bludgeon", upgraded: false };
      s.combat!.hand = [card];
      s.combat!.energy = 9;
      playCard(s, 0, 0);
      expect(s.screen).toBe("victory");
      // 首领金币掉落固定 95-105；首领遗物奖励可能另加金币（如小屋 +50），故按掉落日志校验。
      const dropLine = s.log.find(l => l.includes("击败首领，获得"));
      const dropped = Number(dropLine?.match(/(\d+)/)?.[1]);
      expect(dropped).toBeGreaterThanOrEqual(95);
      expect(dropped).toBeLessThanOrEqual(105);
    }
  });
});
