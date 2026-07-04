import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { GameState } from "../src/engine/types.js";

// 弃牌时触发：急智（弃时回能量）/ 应激反射（弃时抽牌）。走 onDiscard 钩子。

function combat(): GameState {
  const s = newRun({ runId: "od", seed: 38, character: "silent" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("急智：无法打出，被弃时回能量", () => {
  it("直接打出被拒", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "tactician", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(false);
  });

  it("卸货弃掉时回 1 能量", () => {
    const s = combat();
    // unload：造成伤害并弃掉所有非攻击牌（急智是技能，会被弃）。
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "unload", upgraded: false },
      { uid: s.nextUid++, defId: "tactician", upgraded: false },
    ];
    s.combat!.energy = 5;
    const before = s.combat!.energy;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // 卸货花 1 费，急智被弃回 1 能量 → 净 -1。
    expect(s.combat!.energy).toBe(before - 1 + 1);
    expect(s.combat!.discardPile.some(c => c.defId === "tactician")).toBe(true);
  });
});

describe("应激反射：被弃时抽牌", () => {
  it("弃掉时抽 2 张", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "unload", upgraded: false },
      { uid: s.nextUid++, defId: "reflex", upgraded: false },
    ];
    s.combat!.energy = 5;
    expect(playCard(s, 0, 0).ok).toBe(true);
    // reflex 被弃 → 抽 2 张 strike。
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(2);
  });

  it("升级版弃掉时抽 3 张", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "unload", upgraded: false },
      { uid: s.nextUid++, defId: "reflex", upgraded: true },
    ];
    s.combat!.energy = 5;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "strike")).toHaveLength(3);
  });
});
