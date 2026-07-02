import type { CardInstance, CharacterId, GameState } from "./types.js";
import { IRONCLAD_STARTER_DECK } from "./cards/cards.js";
import { IRONCLAD_STARTER_RELIC } from "./relics/relics.js";
import { seedRng } from "./rng.js";
import { endTurn, playCard } from "./combat/combat.js";
import { applyChoose, buildMap, generateReward } from "./run/run.js";

// === 引擎顶层：新建对局 + 动作分发 ===
//
// 纯函数式副作用：applyAction 原地改传入的 GameState。HTTP 层负责 version 自增与存档。

const IRONCLAD_MAX_HP = 80;

export type GameAction =
  | { type: "play_card"; handIndex: number; targetIndex?: number | null }
  | { type: "end_turn" }
  | { type: "choose"; optionIndex: number };

export type ActionResult = { ok: true } | { ok: false; reason: string };

export function newRun(input: {
  runId: string;
  seed: number;
  character?: CharacterId;
  ascension?: number;
}): GameState {
  const character: CharacterId = input.character ?? "ironclad";
  const rng = seedRng(input.seed);
  let nextUid = 1;
  const deck: CardInstance[] = IRONCLAD_STARTER_DECK.map(defId => ({
    uid: nextUid++,
    defId,
    upgraded: false,
  }));
  const state: GameState = {
    version: 0,
    runId: input.runId,
    seed: input.seed,
    character,
    ascension: input.ascension ?? 0,
    screen: "map",
    hp: IRONCLAD_MAX_HP,
    maxHp: IRONCLAD_MAX_HP,
    gold: 0,
    deck,
    relics: [{ id: IRONCLAD_STARTER_RELIC, counter: 0 }],
    map: { nodes: {}, rows: 0, startNodeIds: [], bossNodeId: "" },
    currentNodeId: null,
    combat: null,
    reward: null,
    combatsEntered: 0,
    rng,
    nextUid,
    log: [],
  };
  buildMap(state);
  return state;
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  state.log = [];
  if (state.screen === "gameover" || state.screen === "victory") {
    return { ok: false, reason: "对局已结束，调用 start_run 开始新的一局。" };
  }

  switch (action.type) {
    case "play_card": {
      const result = playCard(state, action.handIndex, action.targetIndex ?? null);
      if (result.ok) {
        settleAfterCombat(state);
      }
      return result;
    }
    case "end_turn": {
      if (state.screen !== "combat") {
        return { ok: false, reason: "现在不在战斗中，无法结束回合。" };
      }
      endTurn(state);
      settleAfterCombat(state);
      return { ok: true };
    }
    case "choose": {
      if (state.screen !== "reward" && state.screen !== "rest" && state.screen !== "map") {
        return { ok: false, reason: "当前屏幕没有可选项。" };
      }
      return applyChoose(state, action.optionIndex);
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return { ok: false, reason: "未知动作。" };
    }
  }
}

/** 战斗胜利后收尾：非 Boss 胜利（combat 清空但 screen 仍为 combat）转卡奖励。 */
function settleAfterCombat(state: GameState): void {
  if (state.combat === null && state.screen === "combat") {
    generateReward(state);
  }
}
