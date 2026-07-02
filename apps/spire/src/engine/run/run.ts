import type { GameState, MapNode } from "../types.js";
import { REWARD_CARD_POOL, getCardDef, costOf } from "../cards/cards.js";
import { NORMAL_ENCOUNTER_POOL } from "../enemies/enemies.js";
import { nextInt } from "../rng.js";
import { startCombat } from "../combat/combat.js";

// === 爬塔 / 地图 / 奖励 / 休息 ===
//
// 切片地图固定形状（issue #234 C4）：3 个普通战斗 → 1 篝火 → 守卫者。
// 无精英、无商店、无未知节点、无分支选路。choose 只用于卡奖励与篝火二选一。

const REST_HEAL_RATIO = 0.3;
const REWARD_CARD_COUNT = 3;

export function buildMap(state: GameState): void {
  const nodes: MapNode[] = [];
  for (let i = 0; i < 3; i += 1) {
    const encounterId = NORMAL_ENCOUNTER_POOL[nextInt(state.rng, NORMAL_ENCOUNTER_POOL.length)]!;
    nodes.push({ type: "combat", encounterId });
  }
  nodes.push({ type: "rest", encounterId: "" });
  nodes.push({ type: "boss", encounterId: "guardian" });
  state.map = { nodes, index: 0 };
}

/** 进入当前 map.index 指向的节点，切到对应屏幕。 */
export function enterNode(state: GameState): void {
  const node = state.map.nodes[state.map.index];
  if (!node) {
    state.screen = "victory";
    return;
  }
  if (node.type === "rest") {
    state.screen = "rest";
    state.log.push("你来到一处篝火。");
    return;
  }
  startCombat(state, node.encounterId);
}

/** 非 Boss 战斗胜利后生成三选一卡奖励。 */
export function generateReward(state: GameState): void {
  const pool = [...REWARD_CARD_POOL];
  const choices: { defId: string; upgraded: boolean }[] = [];
  for (let i = 0; i < REWARD_CARD_COUNT && pool.length > 0; i += 1) {
    const idx = nextInt(state.rng, pool.length);
    choices.push({ defId: pool[idx]!, upgraded: false });
    pool.splice(idx, 1);
  }
  state.reward = { cardChoices: choices };
  state.screen = "reward";
}

/** 当前屏幕可选项（渲染 + 校验 choose 用）。 */
export function currentOptions(state: GameState): string[] {
  if (state.screen === "reward" && state.reward) {
    const cards = state.reward.cardChoices.map(choice => {
      const def = getCardDef(choice.defId);
      const cost = costOf(def, choice.upgraded);
      const desc = choice.upgraded ? def.upgradedDescription : def.description;
      // 选项带牌信息：名 (+升级) 费用 · 效果，方便挑牌时判断（用户反馈）。
      return `${def.name}${choice.upgraded ? "+" : ""} 费${cost ?? "-"} · ${desc}`;
    });
    return [...cards, "跳过（不拿卡）"];
  }
  if (state.screen === "rest") {
    const options = [`休息：回复 ${Math.floor(state.maxHp * REST_HEAL_RATIO)} 点生命`];
    for (const card of upgradableCards(state)) {
      const def = getCardDef(card.defId);
      options.push(`打铁：升级「${def.name}」`);
    }
    return options;
  }
  return [];
}

function upgradableCards(state: GameState): GameState["deck"] {
  return state.deck.filter(card => !card.upgraded && getCardDef(card.defId).cost !== null);
}

export type ChooseResult = { ok: true } | { ok: false; reason: string };

export function applyChoose(state: GameState, optionIndex: number): ChooseResult {
  if (state.screen === "reward" && state.reward) {
    const choices = state.reward.cardChoices;
    if (optionIndex === choices.length) {
      state.log.push("你跳过了卡奖励。");
    } else if (optionIndex >= 0 && optionIndex < choices.length) {
      const pick = choices[optionIndex]!;
      state.deck.push({ uid: state.nextUid++, defId: pick.defId, upgraded: pick.upgraded });
      state.log.push(`你获得了「${getCardDef(pick.defId).name}」。`);
    } else {
      return { ok: false, reason: `选项 ${optionIndex} 无效。` };
    }
    state.reward = null;
    advance(state);
    return { ok: true };
  }

  if (state.screen === "rest") {
    if (optionIndex === 0) {
      const heal = Math.floor(state.maxHp * REST_HEAL_RATIO);
      state.hp = Math.min(state.maxHp, state.hp + heal);
      state.log.push(`你休息了一会儿，回复了 ${heal} 点生命。`);
    } else {
      const upgradable = upgradableCards(state);
      const target = upgradable[optionIndex - 1];
      if (!target) {
        return { ok: false, reason: `选项 ${optionIndex} 无效。` };
      }
      target.upgraded = true;
      state.log.push(`你升级了「${getCardDef(target.defId).name}」。`);
    }
    advance(state);
    return { ok: true };
  }

  return { ok: false, reason: "当前屏幕没有可选项。" };
}

function advance(state: GameState): void {
  state.map.index += 1;
  enterNode(state);
}
