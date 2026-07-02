import type { RngState } from "./types.js";

// === 带种子、可序列化的 RNG（xoshiro128**）===
//
// 硬约束（issue #234 C11）：内部状态必须完整可序列化并从存档精确复原。
// 手写实现、导出 4 个 32-bit word；**绝不用 Math.random / 不可导出 state 的库**。
// 「重启续玩」与「黄金种子回归测试」都压在这一条上。
//
// 所有运算走 >>> 0 保持在无符号 32-bit 域，保证跨平台确定性。

const MASK32 = 0xffffffff;

function rotl(x: number, k: number): number {
  return (((x << k) | (x >>> (32 - k))) & MASK32) >>> 0;
}

/** 用 splitmix32 把一个整数种子铺开成 4 个非零 word。 */
export function seedRng(seed: number): RngState {
  let z = seed >>> 0;
  const next = (): number => {
    z = (z + 0x9e3779b9) >>> 0;
    let x = z;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
    return (x ^ (x >>> 15)) >>> 0;
  };
  const state: RngState = { s0: next(), s1: next(), s2: next(), s3: next() };
  // 避免全零状态（xoshiro 的退化点）。
  if ((state.s0 | state.s1 | state.s2 | state.s3) === 0) {
    state.s0 = 1;
  }
  return state;
}

/** 前进一步，原地改 state，返回 [0, 2^32) 的整数。 */
function nextUint32(state: RngState): number {
  const result = (Math.imul(rotl(Math.imul(state.s1, 5) >>> 0, 7), 9) & MASK32) >>> 0;
  const t = (state.s1 << 9) >>> 0;
  let s2 = (state.s2 ^ state.s0) >>> 0;
  let s3 = (state.s3 ^ state.s1) >>> 0;
  const s1 = (state.s1 ^ s2) >>> 0;
  const s0 = (state.s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);
  state.s0 = s0;
  state.s1 = s1;
  state.s2 = s2;
  state.s3 = s3;
  return result;
}

/** [0, 1) 浮点。 */
export function nextFloat(state: RngState): number {
  return nextUint32(state) / 0x100000000;
}

/** [0, boundExclusive) 的整数；bound<=0 返回 0。 */
export function nextInt(state: RngState, boundExclusive: number): number {
  if (boundExclusive <= 0) {
    return 0;
  }
  return Math.floor(nextFloat(state) * boundExclusive);
}

/** [minInclusive, maxInclusive] 的整数。 */
export function nextRange(state: RngState, minInclusive: number, maxInclusive: number): number {
  if (maxInclusive <= minInclusive) {
    return minInclusive;
  }
  return minInclusive + nextInt(state, maxInclusive - minInclusive + 1);
}

/** 原地 Fisher–Yates 洗牌，消耗 RNG（存档可复现的关键：洗牌也走同一 state）。 */
export function shuffleInPlace<T>(state: RngState, array: T[]): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = nextInt(state, i + 1);
    const tmp = array[i]!;
    array[i] = array[j]!;
    array[j] = tmp;
  }
}
