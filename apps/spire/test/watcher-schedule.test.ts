import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import type { GameState } from "../src/engine/types.js";

// 观者次回合调度：烈怒渐起（预约进愤怒+抽牌）/ 亵渎（进神性、下回合死亡）。

function combat(): GameState {
  const s = newRun({ runId: "wsch", seed: 36, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("烈怒渐起：下回合进入愤怒并抽牌", () => {
  it("打出时不立即换姿态；下回合开始进入愤怒、多抽 2", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 10 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [{ uid: s.nextUid++, defId: "simmering_fury", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 当回合不换姿态。
    expect(s.combat!.playerStance).toBe("none");
    expect(s.combat!.nextTurnStance).toBe("wrath");
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 新回合：已进入愤怒；标准抽 5 + 预约 2 = 7。
    expect(s.combat!.playerStance).toBe("wrath");
    expect(s.combat!.hand).toHaveLength(7);
    expect(s.combat!.nextTurnStance).toBeNull();
  });
});

describe("亵渎：进入神性，下回合开始死亡", () => {
  it("当回合进神性，下回合开始判定死亡", () => {
    const s = combat();
    s.combat!.hand = [{ uid: s.nextUid++, defId: "blasphemy", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerStance).toBe("divinity");
    expect(s.combat!.doomedNextTurn).toBe(true);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 下回合开始：死亡。
    expect(s.hp).toBe(0);
    expect(s.screen).toBe("gameover");
  });
});
