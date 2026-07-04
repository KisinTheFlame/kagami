import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 机器人收尾：循环 / 全息影像 / 递归。

function combat(): GameState {
  const s = newRun({ runId: "d2", seed: 27, character: "defect" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  s.combat!.orbs = [];
  return s;
}

function play(s: GameState, defId: string, target: number | null = null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("循环：回合始额外触发最左球被动", () => {
  it("持有循环 + 冰霜球 → 回合始额外加格挡", () => {
    const s = combat();
    s.combat!.orbs = [{ type: "frost" }];
    s.combat!.playerPowers.push({ id: "loop", amount: 1 });
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 新回合开始时，循环额外触发冰霜被动（+2 格挡）。
    expect(s.combat!.playerBlock).toBeGreaterThanOrEqual(2);
  });
});

describe("全息影像：格挡 + 收回弃牌", () => {
  it("获得格挡并把最近弃牌收回手牌", () => {
    const s = combat();
    s.combat!.discardPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.playerBlock = 0;
    play(s, "hologram", null);
    expect(s.combat!.playerBlock).toBe(3);
    expect(s.combat!.hand.some(c => c.defId === "strike")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "strike")).toBe(false);
  });
});

describe("递归：唤醒最左球并重充同类型", () => {
  it("闪电球被唤醒发伤，随后重新充能一颗闪电", () => {
    const s = combat();
    s.combat!.orbs = [{ type: "lightning" }];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "recursion", null);
    // 唤醒造成伤害。
    expect(s.combat!.enemies[0]!.hp).toBeLessThan(before);
    // 重新充能一颗闪电球。
    expect(s.combat!.orbs.filter(o => o.type === "lightning")).toHaveLength(1);
  });
});
