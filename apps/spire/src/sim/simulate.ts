import { applyAction, newRun } from "../engine/engine.js";
import type { GameState } from "../engine/types.js";
import { GreedyPolicy, type Policy, RandomPolicy } from "./policy.js";
import { seedRng } from "../engine/rng.js";

// === 平衡验证 / 回归模拟器 ===
//
// 跑 N 个种子，用给定策略把每局打到底，产出平衡报告。引擎确定性 ⇒ 同种子同结果，
// 兼作黄金种子回归测试的地基（issue #234）。

const MAX_STEPS_PER_RUN = 4000;

export type RunOutcome = {
  seed: number;
  result: "victory" | "gameover" | "stuck";
  finalScreen: GameState["screen"];
  nodeReached: number;
  finalHp: number;
  steps: number;
  version: number;
};

export function simulateRun(seed: number, makePolicy: () => Policy): RunOutcome {
  const state = newRun({ runId: `sim-${seed}`, seed });
  state.version = 1;
  const policy = makePolicy();
  let steps = 0;
  while (state.screen !== "victory" && state.screen !== "gameover" && steps < MAX_STEPS_PER_RUN) {
    const action = policy.decide(state);
    const result = applyAction(state, action);
    if (result.ok) {
      state.version += 1;
    }
    steps += 1;
  }
  const result =
    state.screen === "victory" ? "victory" : state.screen === "gameover" ? "gameover" : "stuck";
  return {
    seed,
    result,
    finalScreen: state.screen,
    // 爬到的最高层（分支地图下用当前节点的 row 表示进度；未进入任何节点则 0）。
    nodeReached: state.currentNodeId ? (state.map.nodes[state.currentNodeId]?.row ?? 0) : 0,
    finalHp: state.hp,
    steps,
    version: state.version,
  };
}

export type BalanceReport = {
  runs: number;
  policy: string;
  victories: number;
  gameovers: number;
  stuck: number;
  winRate: number;
  avgNodeReached: number;
  avgFinalHp: number;
  avgSteps: number;
};

export function runBalance(input: {
  runs: number;
  policy: "random" | "greedy";
  baseSeed?: number;
}): BalanceReport {
  const baseSeed = input.baseSeed ?? 1;
  const makePolicy = (): Policy =>
    input.policy === "greedy" ? new GreedyPolicy() : new RandomPolicy(seedRng(0xabcdef));
  const outcomes: RunOutcome[] = [];
  for (let i = 0; i < input.runs; i += 1) {
    outcomes.push(simulateRun(baseSeed + i, makePolicy));
  }
  const victories = outcomes.filter(outcome => outcome.result === "victory").length;
  const gameovers = outcomes.filter(outcome => outcome.result === "gameover").length;
  const stuck = outcomes.filter(outcome => outcome.result === "stuck").length;
  const sum = (pick: (outcome: RunOutcome) => number): number =>
    outcomes.reduce((acc, outcome) => acc + pick(outcome), 0);
  return {
    runs: input.runs,
    policy: input.policy,
    victories,
    gameovers,
    stuck,
    winRate: input.runs > 0 ? victories / input.runs : 0,
    avgNodeReached: input.runs > 0 ? sum(o => o.nodeReached) / input.runs : 0,
    avgFinalHp: input.runs > 0 ? sum(o => o.finalHp) / input.runs : 0,
    avgSteps: input.runs > 0 ? sum(o => o.steps) / input.runs : 0,
  };
}
