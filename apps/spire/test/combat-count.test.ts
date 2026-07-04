import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 本场计数：璀璨光辉（+本场法力）/ 暴风雪（×本场充能冰霜数）。

function combat(character: "defect" | "watcher"): GameState {
  const s = newRun({ runId: "cbc", seed: 41, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  if (character === "defect") {
    s.combat!.orbs = [];
    s.combat!.orbSlots = 10;
  }
  return s;
}

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("璀璨光辉：伤害含本场累计法力", () => {
  it("先攒 8 法力（不进神性），再打出 → 12 + 8", () => {
    const s = combat("watcher");
    // pray：获得法力（避免超过 10 进神性影响；用小额）。直接改计数更稳。
    s.combat!.mantraGainedThisCombat = 8;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "brilliance", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - (12 + 8));
  });

  it("gain_mantra 会推进本场法力计数", () => {
    const s = combat("watcher");
    // prostrate/pray 之类给法力；用 prostrate（叩拜）若存在。直接打 pray。
    s.combat!.mantraGainedThisCombat = 0;
    play(s, "pray", null); // 祈祷：获得法力（推进计数）
    expect(s.combat!.mantraGainedThisCombat).toBeGreaterThan(0);
  });
});

describe("暴风雪：伤害 = 本场充能冰霜数 ×2", () => {
  it("已充 3 冰霜 → 全体各受 6", () => {
    const s = combat("defect");
    s.combat!.frostChanneledThisCombat = 3;
    const before = s.combat!.enemies[0]!.hp;
    play(s, "blizzard", null);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 6);
  });

  it("channelOrb 冰霜会推进本场计数", () => {
    const s = combat("defect");
    s.combat!.frostChanneledThisCombat = 0;
    play(s, "cold_snap", 0); // 寒流：造成伤害并充能 1 冰霜
    expect(s.combat!.frostChanneledThisCombat).toBe(1);
  });
});
