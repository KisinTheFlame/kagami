import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import { startCombat } from "../src/engine/combat/combat.js";
import type { GameState } from "../src/engine/types.js";

// 回归：回合开始的抽牌触发效果（火焰吐息随抽到状态牌 AoE）打死最后的敌人时，
// 必须结算胜利，而不是留在「全灭却仍在战斗」的死局（模拟器 9/1000 stuck 的根因）。

describe("回合开始击杀 → 立即结算胜利（不卡死）", () => {
  it("火焰吐息随抽到眩晕 AoE 打死残敌，战斗结束", () => {
    const s: GameState = newRun({ runId: "tsv", seed: 1, character: "ironclad" });
    startCombat(s, "cultist");
    const combat = s.combat!;
    // 玩家带火焰吐息 6：每抽到状态/诅咒牌，对全体造成 6。
    combat.playerPowers = [{ id: "fire_breathing", amount: 6 }];
    // 残敌 5 血；抽牌堆塞满眩晕（状态牌），回合开始抽到即触发 AoE。
    combat.enemies[0]!.hp = 5;
    combat.hand = [];
    combat.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "dazed",
      upgraded: false,
    }));
    s.version = 1;
    applyAction(s, { type: "end_turn" });
    // 敌人被回合开始的 AoE 打死 → 战斗应已结算（combat 清空 + 离开 combat 屏），而非卡死。
    expect(s.combat).toBeNull();
    expect(s.screen).not.toBe("combat");
  });
});
