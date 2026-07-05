import { describe, expect, it } from "vitest";
import { getRelicDef } from "../src/engine/relics/relics.js";
import { newRun } from "../src/engine/engine.js";
import type { Effect, RelicState } from "../src/engine/types.js";

// 洗牌触发型遗物：日晷（每3次+2能量）、算盘（每次+6格挡）。
function shuffleEmits(id: string, times: number): Effect[] {
  const self: RelicState = { id, counter: 0 };
  const out: Effect[] = [];
  const s = newRun({ runId: id, seed: 1 });
  for (let i = 0; i < times; i += 1) getRelicDef(id).hooks.onShuffle?.(s, self, e => out.push(e));
  return out;
}

describe("日晷：每 3 次洗牌 +2 能量", () => {
  it("洗 3 次触发一次", () => {
    expect(shuffleEmits("sundial", 3)).toEqual([{ kind: "gain_energy", amount: 2 }]);
  });
  it("洗 2 次不触发", () => {
    expect(shuffleEmits("sundial", 2)).toEqual([]);
  });
});
describe("算盘：每次洗牌 +6 格挡", () => {
  it("洗 2 次 → 两次 +6 格挡", () => {
    expect(shuffleEmits("the_abacus", 2)).toEqual([
      { kind: "gain_block", amount: 6 },
      { kind: "gain_block", amount: 6 },
    ]);
  });
});
