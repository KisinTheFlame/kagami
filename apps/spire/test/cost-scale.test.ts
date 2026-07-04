import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import type { GameState } from "../src/engine/types.js";

// 降费家族：力场（每能力牌 -1）/ 血债血偿（每失血 -1）。

function combat(character: "defect" | "ironclad"): GameState {
  const s = newRun({ runId: "cs", seed: 44, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("力场：按本场能力牌数降费", () => {
  it("已打出 2 张能力牌 → 力场费用 4-2=2", () => {
    const s = combat("defect");
    s.combat!.powersPlayedThisCombat = 2;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "force_field", upgraded: false }];
    s.combat!.playerBlock = 0;
    s.combat!.energy = 2; // 恰好够降费后的 2。
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
    expect(s.combat!.playerBlock).toBe(12);
  });

  it("打出能力牌会推进计数（力场本身是技能不计）", () => {
    const s = combat("defect");
    s.combat!.powersPlayedThisCombat = 0;
    // 力场本身是技能，不推进计数。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "force_field", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.powersPlayedThisCombat).toBe(0);
    // 打出一张能力牌（碎片整理）才推进计数。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "defragment", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.powersPlayedThisCombat).toBe(1);
  });
});

describe("血债血偿：按本场失血次数降费", () => {
  it("已失血 2 次 → 费用 4-2=2", () => {
    const s = combat("ironclad");
    s.combat!.timesLostHpThisCombat = 2;
    s.combat!.hand = [{ uid: s.nextUid++, defId: "blood_for_blood", upgraded: false }];
    s.combat!.energy = 2;
    const before = s.combat!.enemies[0]!.hp;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 18);
  });

  it("受击穿透失血会推进计数", () => {
    const s = combat("ironclad");
    s.combat!.timesLostHpThisCombat = 0;
    s.combat!.playerBlock = 0; // 无格挡，邪教徒黑暗强击必穿透。
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 强制敌人本回合攻击。
    const hpBefore = s.hp;
    endTurn(s);
    // 玩家被打掉血 → 计数 +1。
    expect(s.hp).toBeLessThan(hpBefore);
    expect(s.combat!.timesLostHpThisCombat).toBe(1);
  });
});
