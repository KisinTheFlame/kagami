import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M3b-3：哨卫（3 个）——神器抵消减益、虚无眩晕、错位光束/射钉交替。asc0。

function sentryFight(seed = 1): GameState {
  const s = newRun({ runId: `sen${seed}`, seed });
  startCombat(s, "three_sentries");
  s.hp = 500;
  s.maxHp = 500;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("哨卫：开局", () => {
  it("3 个哨卫，各 38-42 HP，各带 1 层神器", () => {
    const s = sentryFight();
    expect(s.combat!.enemies).toHaveLength(3);
    for (const e of s.combat!.enemies) {
      expect(e.hp).toBeGreaterThanOrEqual(38);
      expect(e.hp).toBeLessThanOrEqual(42);
      expect(getPower(e.powers, "artifact")).toBe(1);
    }
  });

  it("错位开局：两侧(0/2)先射钉、中间(1)先光束", () => {
    const s = sentryFight();
    expect(s.combat!.enemies[0]!.currentMove).toBe("bolt");
    expect(s.combat!.enemies[1]!.currentMove).toBe("beam");
    expect(s.combat!.enemies[2]!.currentMove).toBe("bolt");
  });
});

describe("神器：抵消减益", () => {
  it("首个易伤被神器吃掉、第二个才生效", () => {
    const s = sentryFight();
    play(s, "bash"); // 8 伤 + 易伤 2，目标 0 号
    expect(getPower(s.combat!.enemies[0]!.powers, "artifact")).toBe(0); // 神器消耗
    expect(getPower(s.combat!.enemies[0]!.powers, "vulnerable")).toBe(0); // 易伤被抵消
    // 再上一次易伤 → 这次生效
    play(s, "bash"); // 目标默认 0
    expect(getPower(s.combat!.enemies[0]!.powers, "vulnerable")).toBe(2);
  });

  it("神器不挡伤害，只挡减益", () => {
    const s = sentryFight();
    const before = s.combat!.enemies[0]!.hp;
    play(s, "strike"); // 6 伤，无减益
    expect(s.combat!.enemies[0]!.hp).toBe(before - 6);
    expect(getPower(s.combat!.enemies[0]!.powers, "artifact")).toBe(1); // 神器不消耗
  });
});

describe("射钉：塞虚无眩晕", () => {
  it("射钉往弃牌堆塞 2 张眩晕，回合末虚无消耗", () => {
    const s = sentryFight();
    // 只留 0 号哨卫（射钉），其余清空，避免中间那个打人干扰。
    s.combat!.enemies[1]!.hp = 0;
    s.combat!.enemies[2]!.hp = 0;
    const dazedBefore = s.combat!.discardPile.filter(c => c.defId === "dazed").length;
    endTurn(s); // 0 号执行射钉 → 弃牌堆 +2 眩晕
    const dazedAfter = s.combat!.discardPile.filter(c => c.defId === "dazed").length;
    expect(dazedAfter - dazedBefore).toBe(2);

    // 把一张眩晕塞进手牌，结束回合这张应被消耗（虚无）——按 uid 精确追踪
    // （新回合可能又从弃牌堆抽到别的眩晕，只验证「这张」进了消耗堆、没留在手里）。
    const dazed: CardInstance = { uid: 999999, defId: "dazed", upgraded: false };
    s.combat!.hand = [dazed];
    endTurn(s);
    expect(s.combat!.exhaustPile.some(c => c.uid === 999999)).toBe(true);
    expect(s.combat!.hand.some(c => c.uid === 999999)).toBe(false);
  });

  it("眩晕无法打出", () => {
    const s = sentryFight();
    const dazed: CardInstance = { uid: s.nextUid++, defId: "dazed", upgraded: false };
    s.combat!.hand = [dazed];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(false);
  });
});

describe("光束↔射钉严格交替", () => {
  it("中间哨卫 光束→射钉→光束", () => {
    const s = sentryFight();
    // 单独驱动 1 号哨卫，杀掉 0/2 避免它们打死我们（其实 hp 高无所谓）。
    const mid = s.combat!.enemies[1]!;
    expect(mid.currentMove).toBe("beam");
    endTurn(s);
    expect(mid.currentMove).toBe("bolt");
    endTurn(s);
    expect(mid.currentMove).toBe("beam");
  });
});
