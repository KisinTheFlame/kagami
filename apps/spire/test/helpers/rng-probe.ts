import { nextFloat, seedRng, shuffleInPlace } from "../../src/engine/rng.js";
import type { RngState } from "../../src/engine/types.js";

export { seedRng, shuffleInPlace };

/** 取 n 个连续随机浮点，用于确定性/序列化断言。 */
export function nextUint32Sequence(state: RngState, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(nextFloat(state));
  }
  return out;
}
