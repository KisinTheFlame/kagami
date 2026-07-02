import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { grantRandomRelic } from "../src/engine/run/run.js";
import { COMMON_RELIC_POOL } from "../src/engine/relics/relics.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M3a：遗物地基 + 战斗事件钩子（onCombatStart / onCombatEnd）。数值对齐 StS asc0。

function run(relicIds: string[]): GameState {
  const s = newRun({ runId: "relic", seed: 1 });
  s.relics = relicIds.map(id => ({ id, counter: 0 }));
  return s;
}

describe("起始遗物", () => {
  it("铁甲战士开局自带燃烧之血", () => {
    const s = newRun({ runId: "starter", seed: 1 });
    expect(s.relics.map(r => r.id)).toEqual(["burning_blood"]);
  });
});

describe("燃烧之血：战斗胜利回 6 血", () => {
  it("残血胜利后 +6", () => {
    const s = run(["burning_blood"]);
    startCombat(s, "cultist");
    s.hp = 50;
    s.maxHp = 80;
    s.combat!.enemies[0]!.hp = 1;
    const card: CardInstance = { uid: s.nextUid++, defId: "bludgeon", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    playCard(s, 0, 0);
    expect(s.combat).toBeNull(); // 已胜利
    expect(s.hp).toBe(56);
  });

  it("回血不超过上限", () => {
    const s = run(["burning_blood"]);
    startCombat(s, "cultist");
    s.hp = 78;
    s.maxHp = 80;
    s.combat!.enemies[0]!.hp = 1;
    const card: CardInstance = { uid: s.nextUid++, defId: "bludgeon", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    playCard(s, 0, 0);
    expect(s.hp).toBe(80);
  });
});

describe("战斗开始遗物", () => {
  it("船锚：开局 +10 格挡", () => {
    const s = run(["anchor"]);
    startCombat(s, "cultist");
    expect(s.combat!.playerBlock).toBe(10);
  });

  it("金刚杵：开局 +1 力量", () => {
    const s = run(["vajra"]);
    startCombat(s, "cultist");
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(1);
  });

  it("血瓶：开局回 2 血", () => {
    const s = run(["blood_vial"]);
    s.hp = 50;
    s.maxHp = 80;
    startCombat(s, "cultist");
    expect(s.hp).toBe(52);
  });

  it("提灯：首回合 +1 能量（4 点）", () => {
    const s = run(["lantern"]);
    startCombat(s, "cultist");
    expect(s.combat!.energy).toBe(4);
  });

  it("弹珠袋：开局全体敌人 +1 易伤", () => {
    const s = run(["bag_of_marbles"]);
    startCombat(s, "two_louse");
    for (const enemy of s.combat!.enemies) {
      expect(getPower(enemy.powers, "vulnerable")).toBe(1);
    }
  });

  it("多个遗物叠加生效", () => {
    const s = run(["anchor", "vajra", "lantern"]);
    startCombat(s, "cultist");
    expect(s.combat!.playerBlock).toBe(10);
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(1);
    expect(s.combat!.energy).toBe(4);
  });
});

describe("宝箱 / 掉落给遗物", () => {
  it("给一个未持有的普通遗物", () => {
    const s = run([]);
    grantRandomRelic(s);
    expect(s.relics).toHaveLength(1);
    expect(COMMON_RELIC_POOL).toContain(s.relics[0]!.id);
  });

  it("不重复给已持有的遗物", () => {
    const s = run(COMMON_RELIC_POOL.slice()); // 已持有全部普通遗物
    const goldBefore = s.gold;
    grantRandomRelic(s);
    // 无可给遗物 → 兜底给金币，遗物数不变。
    expect(s.relics).toHaveLength(COMMON_RELIC_POOL.length);
    expect(s.gold).toBeGreaterThan(goldBefore);
  });
});
