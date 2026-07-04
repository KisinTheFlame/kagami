import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 自我成长卡：遗传演算 / 泄压护罩 / 风车斩（复用 grow_self）。

function combat(character: "defect" | "watcher"): GameState {
  const s = newRun({ runId: "g2", seed: 33, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  s.combat!.orbs = [];
  return s;
}

// 复用同一张卡实例（bonus 存在实例上）：打出后把同一对象放回手牌再打。
function playTwice(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  for (let i = 0; i < 2; i++) {
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, target).ok).toBe(true);
  }
}

describe("遗传演算：格挡逐次增长", () => {
  it("首打 1 格挡，次打 3 格挡（+2）", () => {
    const s = combat("defect");
    s.combat!.playerBlock = 0;
    playTwice(s, "genetic_algorithm", null);
    // 1（首打）+ 3（次打，本牌已 +2）= 4。
    expect(s.combat!.playerBlock).toBe(4);
  });
});

describe("泄压护罩：格挡逐次递减", () => {
  it("首打 6，次打 5（-1）", () => {
    const s = combat("defect");
    s.combat!.playerBlock = 0;
    playTwice(s, "steam_barrier", null);
    expect(s.combat!.playerBlock).toBe(11);
  });
});

describe("风车斩：伤害逐次增长", () => {
  it("首打 7，次打 11（+4）", () => {
    const s = combat("watcher");
    const before = s.combat!.enemies[0]!.hp;
    playTwice(s, "windmill_strike", 0);
    // 7 + 11 = 18。
    expect(s.combat!.enemies[0]!.hp).toBe(before - 18);
  });
});
