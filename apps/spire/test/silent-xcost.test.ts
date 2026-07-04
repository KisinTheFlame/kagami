import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 潜行者 X 费/条件牌：镜影分身 / 脱身之策。

function combat(): GameState {
  const s = newRun({ runId: "sx", seed: 34, character: "silent" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("镜影分身：下回合多抽多能量", () => {
  it("X=3 → 下回合预约多抽 3、多得 3 能量", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "doppelganger", upgraded: false }];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.energy).toBe(0); // X 费吃光能量。
    expect(s.combat!.nextTurnDraw).toBe(3);
    expect(s.combat!.nextTurnEnergy).toBe(3);
    // 消耗牌。
    expect(s.combat!.exhaustPile.some(c => c.defId === "doppelganger")).toBe(true);
  });
});

describe("脱身之策：抽到技能才给格挡", () => {
  it("抽到技能 → 获得 3 格挡", () => {
    const s = combat();
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "defend", upgraded: false }];
    s.combat!.hand = [{ uid: s.nextUid++, defId: "escape_plan", upgraded: false }];
    s.combat!.playerBlock = 0;
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(3);
  });

  it("抽到攻击 → 无格挡", () => {
    const s = combat();
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.hand = [{ uid: s.nextUid++, defId: "escape_plan", upgraded: false }];
    s.combat!.playerBlock = 0;
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(0);
  });
});

describe("镜影分身：预约在下回合兑现", () => {
  it("回合开始多抽多能量", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    const card: CardInstance = { uid: s.nextUid++, defId: "doppelganger", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 2;
    expect(playCard(s, 0, null).ok).toBe(true);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    const baseEnergy = s.combat!.maxEnergy;
    endTurn(s);
    // 新回合：多得 2 能量。
    expect(s.combat!.energy).toBe(baseEnergy + 2);
    // 标准抽 5 + 预约多抽 2 = 7。
    expect(s.combat!.hand).toHaveLength(7);
  });
});
