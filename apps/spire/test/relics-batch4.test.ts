import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, endTurn } from "../src/engine/combat/combat.js";
import { grantRelic, getRelicDef } from "../src/engine/relics/relics.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { Effect, GameState, RelicState } from "../src/engine/types.js";

// PR（减伤 / 失血联动遗物批次）。

function combat(relic: string): GameState {
  const s = newRun({ runId: "rb4", seed: 8, character: "ironclad" });
  grantRelic(s, relic);
  startCombat(s, "cultist");
  s.hp = 200;
  s.maxHp = 200;
  return s;
}

describe("钨钢棒：每次失血少 1", () => {
  it("邪教徒暗袭 6 → 只失 5", () => {
    const s = combat("tungsten_rod");
    s.combat!.playerBlock = 0;
    s.combat!.enemies[0]!.currentMove = "dark_strike";
    const hp = s.hp;
    endTurn(s);
    expect(hp - s.hp).toBe(5);
  });
});

describe("鸟居：≤5 无格挡攻击伤害降为 1", () => {
  it("被削弱后的暗袭（≤5）→ 只受 1", () => {
    const s = combat("torii");
    s.combat!.playerBlock = 0;
    s.combat!.enemies[0]!.powers.push({ id: "weak", amount: 3 }); // 6×0.75=4 ≤5
    s.combat!.enemies[0]!.currentMove = "dark_strike";
    const hp = s.hp;
    endTurn(s);
    expect(hp - s.hp).toBe(1);
  });
});

describe("化石螺壳：战斗开始 +1 缓冲", () => {
  it("战斗开始即持有 1 层缓冲", () => {
    const s = combat("fossilized_helix");
    expect(getPower(s.combat!.playerPowers, "buffer")).toBe(1);
  });
});

describe("符文魔方：失血抽 1（onLoseHp 钩子）", () => {
  it("失血 emit 抽 1", () => {
    const s = newRun({ runId: "rc", seed: 1, character: "ironclad" });
    const self: RelicState = { id: "runic_cube", counter: 0 };
    const emitted: Effect[] = [];
    getRelicDef("runic_cube").hooks.onLoseHp?.(s, self, e => emitted.push(e));
    expect(emitted).toEqual([{ kind: "draw", amount: 1 }]);
  });
});
