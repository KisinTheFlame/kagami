import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { GameState } from "../src/engine/types.js";

// 机器人充能补全：雷暴倾泻（X 费充闪电）/ 透骨寒（每敌一冰霜）。

function combat(): GameState {
  const s = newRun({ runId: "d2", seed: 35, character: "defect" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.orbs = [];
  s.combat!.orbSlots = 10;
  return s;
}

describe("雷暴倾泻：X 费充能 X 颗闪电", () => {
  it("X=3 → 充能 3 颗闪电球", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "tempest", upgraded: false }];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.energy).toBe(0);
    expect(s.combat!.orbs.filter(o => o.type === "lightning")).toHaveLength(3);
    expect(s.combat!.exhaustPile.some(c => c.defId === "tempest")).toBe(true);
  });
});

describe("透骨寒：每个存活敌人充能 1 冰霜", () => {
  it("双敌 → 充能 2 颗冰霜球", () => {
    const s = combat();
    s.combat!.enemies.push({ ...s.combat!.enemies[0]!, hp: 20, maxHp: 20 });
    s.combat!.hand = [{ uid: s.nextUid++, defId: "chill", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.orbs.filter(o => o.type === "frost")).toHaveLength(2);
  });

  it("一个敌人已死 → 只按存活数充能", () => {
    const s = combat();
    s.combat!.enemies.push({ ...s.combat!.enemies[0]!, hp: 0, maxHp: 20 });
    s.combat!.hand = [{ uid: s.nextUid++, defId: "chill", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.orbs.filter(o => o.type === "frost")).toHaveLength(1);
  });
});
