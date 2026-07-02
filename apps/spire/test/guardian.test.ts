import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, EnemyState, GameState } from "../src/engine/types.js";

// 守卫者忠实化：进攻固定链、模式切换、防御三招链、反甲反弹。数值对齐 sts_lightspeed（asc0）。

function guardianFight(seed: number): GameState {
  const state = newRun({ runId: `g${seed}`, seed });
  startCombat(state, "guardian");
  state.hp = 9999;
  state.maxHp = 9999;
  return state;
}

function guardian(state: GameState): EnemyState {
  return state.combat!.enemies[0]!;
}

function strikeInHand(state: GameState): void {
  const card: CardInstance = { uid: 9999, defId: "strike", upgraded: false };
  state.combat!.hand = [card];
  state.combat!.energy = 3;
}

describe("守卫者姿态机", () => {
  it("进攻姿态固定循环：蓄能→重砸→泄气→旋风→蓄能", () => {
    const s = guardianFight(1);
    const seq: string[] = [guardian(s).currentMove];
    for (let i = 0; i < 4; i += 1) {
      endTurn(s);
      seq.push(guardian(s).currentMove);
    }
    expect(seq).toEqual(["charging_up", "fierce_bash", "vent_steam", "whirlwind", "charging_up"]);
  });

  it("防御三招链：防御形态→滚压→双重猛击→回进攻旋风；反甲随链结束清除", () => {
    const s = guardianFight(3);
    const g = guardian(s);
    // 模拟刚触发模式切换后的可观察状态（triggerModeShift 的结果）。
    g.stance = "defensive";
    g.rotationIndex = 1;
    g.currentMove = "defensive_mode";

    endTurn(s); // 执行 防御形态 → 获得反甲 3
    expect(getPower(g.powers, "sharp_hide")).toBe(3);
    expect(g.currentMove).toBe("roll_attack");

    endTurn(s); // 执行 滚压
    expect(g.currentMove).toBe("twin_slam");

    endTurn(s); // 执行 双重猛击 → 回进攻姿态旋风、清反甲
    expect(g.stance).toBe("offensive");
    expect(getPower(g.powers, "sharp_hide")).toBe(0);
    expect(g.currentMove).toBe("whirlwind");

    endTurn(s); // 执行 旋风 → 续接进攻链首招
    expect(g.currentMove).toBe("charging_up");
  });

  it("反甲：攻击带反甲的守卫者，玩家受无视格挡的反弹伤害", () => {
    const s = guardianFight(4);
    guardian(s).powers.push({ id: "sharp_hide", amount: 3 });
    strikeInHand(s);
    s.hp = 50;
    s.maxHp = 50;
    const before = s.hp;
    const result = playCard(s, 0, 0);
    expect(result.ok).toBe(true);
    expect(s.hp).toBe(before - 3);
  });

  it("反甲可在玩家自己回合内反杀 → gameover", () => {
    const s = guardianFight(5);
    guardian(s).powers.push({ id: "sharp_hide", amount: 5 });
    strikeInHand(s);
    s.hp = 3;
    s.maxHp = 80;
    playCard(s, 0, 0);
    expect(s.hp).toBe(0);
    expect(s.screen).toBe("gameover");
  });
});
