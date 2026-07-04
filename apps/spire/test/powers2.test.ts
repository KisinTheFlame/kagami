import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 回身步（下一张攻击免费）/ 敏锐（飞刀 +伤害）。

function combat(character: "silent" | "watcher"): GameState {
  const s = newRun({ runId: "p2", seed: 42, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function play(s: GameState, defId: string, target: number | null, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("回身步：下一张攻击费用为 0", () => {
  it("挂上 free_attack 后，重击（原价 2）免费打出", () => {
    const s = combat("watcher");
    play(s, "swivel", null);
    expect(getPower(s.combat!.playerPowers, "free_attack")).toBe(1);
    expect(s.combat!.playerBlock).toBe(8);
    // 只给 0 能量也能打出攻击（bludgeon/heavy 之类原价高）。
    const card: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 0;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // free_attack 消耗掉。
    expect(getPower(s.combat!.playerPowers, "free_attack")).toBe(0);
  });

  it("免费只作用于攻击牌，技能不吃", () => {
    const s = combat("watcher");
    play(s, "swivel", null);
    const card: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 0; // defend 原价 1，无能量应打不出。
    expect(playCard(s, 0, null).ok).toBe(false);
    // free_attack 仍在。
    expect(getPower(s.combat!.playerPowers, "free_attack")).toBe(1);
  });
});

describe("敏锐：飞刀额外伤害", () => {
  it("挂上敏锐后飞刀多打 3", () => {
    const s = combat("silent");
    play(s, "accuracy", null);
    expect(getPower(s.combat!.playerPowers, "accuracy")).toBe(3);
    const before = s.combat!.enemies[0]!.hp;
    // 飞刀基础 4 伤 → 4 + 3 = 7。
    play(s, "shiv", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 7);
  });

  it("普通攻击不吃敏锐加成", () => {
    const s = combat("silent");
    play(s, "accuracy", null);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0); // 6 伤，不加敏锐。
    expect(s.combat!.enemies[0]!.hp).toBe(before - 6);
  });
});
