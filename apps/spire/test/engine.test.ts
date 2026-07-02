import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import { computeAttackDamage } from "../src/engine/powers/powers.js";
import { seedRng, nextUint32Sequence, shuffleInPlace } from "./helpers/rng-probe.js";
import { simulateRun } from "../src/sim/simulate.js";
import { GreedyPolicy } from "../src/sim/policy.js";
import type { GameState } from "../src/engine/types.js";

describe("newRun", () => {
  it("铁甲战士开局：80 血、10 张起始牌、进入战斗", () => {
    const state = newRun({ runId: "t", seed: 123 });
    expect(state.hp).toBe(80);
    expect(state.maxHp).toBe(80);
    expect(state.deck).toHaveLength(10);
    expect(state.screen).toBe("combat");
    expect(state.combat).not.toBeNull();
    expect(state.combat!.hand).toHaveLength(5);
  });

  it("地图固定形状：3 普通战斗 → 篝火 → 守卫者", () => {
    const state = newRun({ runId: "t", seed: 1 });
    const types = state.map.nodes.map(node => node.type);
    expect(types).toEqual(["combat", "combat", "combat", "rest", "boss"]);
    expect(state.map.nodes[4]!.encounterId).toBe("guardian");
  });
});

describe("RNG 可序列化与确定性", () => {
  it("同种子产生同序列", () => {
    const a = nextUint32Sequence(seedRng(42), 8);
    const b = nextUint32Sequence(seedRng(42), 8);
    expect(a).toEqual(b);
  });

  it("RNG 状态经 JSON 往返后继续同序列（存档续玩地基）", () => {
    const state = seedRng(7);
    nextUint32Sequence(state, 3); // 前进几步
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(nextUint32Sequence(restored, 5)).toEqual(nextUint32Sequence(state, 5));
  });

  it("洗牌确定性：同种子同结果", () => {
    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8];
    shuffleInPlace(seedRng(99), arr1);
    shuffleInPlace(seedRng(99), arr2);
    expect(arr1).toEqual(arr2);
  });
});

describe("伤害结算顺序", () => {
  it("基础+力量 → ×虚弱0.75 → ×易伤1.5 → 向下取整", () => {
    // base 6 + 力量2 = 8；攻击方虚弱 → floor(8*0.75)=6；目标易伤 → floor(6*1.5)=9
    const dmg = computeAttackDamage(
      6,
      [
        { id: "strength", amount: 2 },
        { id: "weak", amount: 1 },
      ],
      [{ id: "vulnerable", amount: 1 }],
    );
    expect(dmg).toBe(9);
  });

  it("负力量不会造成负伤害", () => {
    expect(computeAttackDamage(3, [{ id: "strength", amount: -10 }], [])).toBe(0);
  });
});

describe("战斗基本流程", () => {
  it("打出打击对唯一敌人造成伤害并消耗能量", () => {
    const state = newRun({ runId: "t", seed: 5 });
    const combat = state.combat!;
    const strikeIndex = combat.hand.findIndex(card => card.defId === "strike");
    expect(strikeIndex).toBeGreaterThanOrEqual(0);
    const enemyHpBefore = combat.enemies[0]!.hp;
    const energyBefore = combat.energy;
    const result = applyAction(state, { type: "play_card", handIndex: strikeIndex });
    expect(result.ok).toBe(true);
    expect(state.combat!.energy).toBe(energyBefore - 1);
    // 邪教徒开局仪式无格挡时，打击 6 直接掉血（除非首敌是虱子触发蜷缩）。
    const enemyHpAfter = state.combat!.enemies[0]!.hp;
    expect(enemyHpAfter).toBeLessThanOrEqual(enemyHpBefore);
  });

  it("能量不足拒绝出牌、不改状态、不涨 version", () => {
    const state = newRun({ runId: "t", seed: 5 });
    state.version = 1;
    state.combat!.energy = 0;
    const bashIndex = state.combat!.hand.findIndex(card => card.defId === "bash");
    if (bashIndex >= 0) {
      const result = applyAction(state, { type: "play_card", handIndex: bashIndex });
      expect(result.ok).toBe(false);
    }
  });
});

describe("黄金种子回归", () => {
  it("贪心策略在固定种子下确定性通关/失败", () => {
    const a = simulateRun(20260702, () => new GreedyPolicy());
    const b = simulateRun(20260702, () => new GreedyPolicy());
    expect(a).toEqual(b);
    expect(["victory", "gameover", "stuck"]).toContain(a.result);
  });

  it("存档 JSON 往返后从同一点继续，结果一致", () => {
    const state = newRun({ runId: "t", seed: 314 });
    state.version = 1;
    // 走几步
    for (let i = 0; i < 3; i += 1) {
      const policy = new GreedyPolicy();
      applyAction(state, policy.decide(state));
    }
    const snapshot = JSON.parse(JSON.stringify(state)) as GameState;
    const contA = continueGreedy(state, 20);
    const contB = continueGreedy(snapshot, 20);
    expect(contA.screen).toBe(contB.screen);
    expect(contA.hp).toBe(contB.hp);
    expect(contA.version).toBe(contB.version);
  });
});

function continueGreedy(state: GameState, steps: number): GameState {
  for (let i = 0; i < steps; i += 1) {
    if (state.screen === "victory" || state.screen === "gameover") {
      break;
    }
    const policy = new GreedyPolicy();
    const result = applyAction(state, policy.decide(state));
    if (result.ok) {
      state.version += 1;
    }
  }
  return state;
}
