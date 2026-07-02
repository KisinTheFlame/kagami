import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { generateReward } from "../src/engine/run/run.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M3b-1：精英节点 + 地精头目（激怒）+ 精英遗物奖励。数值对齐 sts_lightspeed asc0。

function nobFight(seed = 1): GameState {
  const s = newRun({ runId: `nob${seed}`, seed });
  startCombat(s, "gremlin_nob");
  s.hp = 200;
  s.maxHp = 200;
  return s;
}

function nob(s: GameState) {
  return s.combat!.enemies[0]!;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("地精头目：血量 + 开局", () => {
  it("HP 落在 82-86", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const s = nobFight(seed);
      expect(nob(s).hp).toBeGreaterThanOrEqual(82);
      expect(nob(s).hp).toBeLessThanOrEqual(86);
    }
  });

  it("首招是咆哮（上激怒）", () => {
    const s = nobFight();
    expect(nob(s).currentMove).toBe("bellow");
  });
});

describe("激怒：玩家出技能牌它加力量", () => {
  it("咆哮后每打一张技能牌 +2 力量，攻击牌不触发", () => {
    const s = nobFight();
    endTurn(s); // 地精头目执行咆哮 → 激怒 2
    expect(getPower(nob(s).powers, "enrage")).toBe(2);
    expect(getPower(nob(s).powers, "strength")).toBe(0);

    play(s, "defend", null); // 技能牌 → +2 力量
    expect(getPower(nob(s).powers, "strength")).toBe(2);

    play(s, "defend", null); // 再一张技能牌 → +2 → 4
    expect(getPower(nob(s).powers, "strength")).toBe(4);

    play(s, "strike"); // 攻击牌 → 不触发
    expect(getPower(nob(s).powers, "strength")).toBe(4);
  });

  it("激怒前（还没咆哮）出技能牌不加力量", () => {
    const s = nobFight();
    play(s, "defend", null);
    expect(getPower(nob(s).powers, "strength")).toBe(0);
  });
});

describe("精英遗物奖励", () => {
  it("pendingRelicReward 时胜利发一个遗物并清标志", () => {
    const s = newRun({ runId: "reward", seed: 1 });
    const before = s.relics.length;
    s.pendingRelicReward = true;
    generateReward(s);
    expect(s.relics.length).toBe(before + 1);
    expect(s.pendingRelicReward).toBe(false);
    expect(s.screen).toBe("reward");
  });

  it("普通战斗（无 pending）不发遗物", () => {
    const s = newRun({ runId: "normal", seed: 1 });
    const before = s.relics.length;
    generateReward(s);
    expect(s.relics.length).toBe(before);
  });
});
