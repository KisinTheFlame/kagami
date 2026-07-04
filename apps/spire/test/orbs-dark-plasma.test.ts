import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 暗球 / 等离子球（机器人）：暗球累积伤害后唤醒打出、等离子给能量、球槽增减。

function combat(): GameState {
  const s = newRun({ runId: "orb", seed: 11, character: "defect" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  s.combat!.orbs = []; // 清掉残破核心开局充的那颗闪电球，便于隔离测试。
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("暗球", () => {
  it("黑暗充能 1 颗暗球（初始累积 0）", () => {
    const s = combat();
    play(s, "darkness");
    expect(s.combat!.orbs).toHaveLength(1);
    expect(s.combat!.orbs[0]!.type).toBe("dark");
    expect(s.combat!.orbs[0]!.value).toBe(0);
  });

  it("暗球回合结束累积 6（集中 0）", () => {
    const s = combat();
    play(s, "darkness");
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation"; // 蓄力不打人
    endTurn(s);
    expect(s.combat!.orbs[0]!.value).toBe(6);
  });

  it("暗球唤醒把累积伤害打给敌人", () => {
    const s = combat();
    play(s, "darkness");
    s.combat!.orbs[0]!.value = 15;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "dualcast"); // 唤醒最左侧的球
    expect(s.combat!.enemies[0]!.hp).toBe(before - 15);
    expect(s.combat!.orbs).toHaveLength(0);
  });
});

describe("等离子球", () => {
  it("聚变充能等离子；唤醒给 2 能量", () => {
    const s = combat();
    play(s, "fusion");
    expect(s.combat!.orbs[0]!.type).toBe("plasma");
    const card: CardInstance = { uid: s.nextUid++, defId: "dualcast", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    // dualcast 花 1 费 → 2，唤醒等离子 +2 → 4。
    expect(s.combat!.energy).toBe(4);
  });
});

describe("球槽增减", () => {
  it("电容器 +2 球槽", () => {
    const s = combat();
    expect(s.combat!.orbSlots).toBe(3);
    play(s, "capacitor");
    expect(s.combat!.orbSlots).toBe(5);
  });

  it("吞噬 +2 集中、-1 球槽", () => {
    const s = combat();
    play(s, "consume");
    expect(s.combat!.orbSlots).toBe(2);
    expect(s.combat!.playerPowers.find(p => p.id === "focus")?.amount).toBe(2);
  });
});

describe("彩虹 / 末日阴云", () => {
  it("彩虹各充 1 颗闪电/冰霜/暗", () => {
    const s = combat();
    play(s, "rainbow");
    const types = s.combat!.orbs.map(o => o.type);
    expect(types).toEqual(["lightning", "frost", "dark"]);
  });

  it("末日阴云对全体发伤 + 充暗球", () => {
    const s = combat();
    const before = s.combat!.enemies[0]!.hp;
    play(s, "doom_and_gloom");
    expect(s.combat!.enemies[0]!.hp).toBe(before - 10);
    expect(s.combat!.orbs.some(o => o.type === "dark")).toBe(true);
  });
});

describe("卡池归属", () => {
  it("暗/等离子牌进入蓝池", () => {
    expect(cardPoolOf("blue", "uncommon")).toContain("darkness");
    expect(cardPoolOf("blue", "rare")).toContain("fusion");
    expect(cardPoolOf("blue", "rare")).toContain("consume");
    expect(cardPoolOf("blue", "uncommon")).toContain("capacitor");
  });
});
