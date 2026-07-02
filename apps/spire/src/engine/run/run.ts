import type { GameState, MapNode, MapNodeType } from "../types.js";
import { REWARD_CARD_POOL, getCardDef, costOf } from "../cards/cards.js";
import { pickBossEncounter, pickEliteEncounter, pickNormalEncounter } from "../enemies/enemies.js";
import { COMMON_RELIC_POOL, getRelicDef, hasRelic } from "../relics/relics.js";
import { BASE_POTION_DROP_CHANCE, POTION_DROP_POOL, getPotionDef } from "../potions/potions.js";
import { EVENT_POOL, getEventDef } from "../events/events.js";
import type { EventOutcome } from "../events/events.js";
import { nextInt, nextRange } from "../rng.js";
import { startCombat } from "../combat/combat.js";
import { generateMap, availableNext } from "../map/map.js";

// === 爬塔 / 分支地图 / 奖励 / 休息 / 宝箱 ===
//
// 分支地图（StS 节点图）：在 "map" 屏 choose 一个上层节点 → 进入该节点（战斗/精英/未知/篝火/宝箱/Boss）
// → 结算后回到 "map" 屏继续选路，直到 Boss。节点类型内容随里程碑启用（商店待后续）。

const REST_HEAL_RATIO = 0.3;
const REWARD_CARD_COUNT = 3;
const TREASURE_GOLD_MIN = 25;
const TREASURE_GOLD_MAX = 35;

/** 本里程碑启用的地图节点类型（商店随后续里程碑加入）。 */
const ENABLED_MAP_TYPES: readonly MapNodeType[] = ["combat", "elite", "event", "rest", "treasure"];

const NODE_TYPE_LABELS: Record<MapNodeType, string> = {
  combat: "战斗",
  elite: "精英",
  event: "未知",
  rest: "篝火",
  shop: "商店",
  treasure: "宝箱",
  boss: "首领",
};

export function buildMap(state: GameState): void {
  state.map = generateMap(state.rng, ENABLED_MAP_TYPES);
  state.currentNodeId = null;
  state.screen = "map";
}

/** 进入一个地图节点：按类型路由。战斗/Boss 起战斗；篝火切 rest 屏；宝箱即时给金币后回地图。 */
function resolveNode(state: GameState, node: MapNode): void {
  state.currentNodeId = node.id;
  switch (node.type) {
    case "combat": {
      // 前若干场抽 weak 池、其余抽 strong 池（复刻 StS Act1 战斗节奏）。
      const encounterId = pickNormalEncounter(state.rng, state.combatsEntered);
      state.combatsEntered += 1;
      startCombat(state, encounterId);
      return;
    }
    case "elite": {
      // 精英战：独立精英池；胜利后必发 1 个遗物。
      startCombat(state, pickEliteEncounter(state.rng));
      state.pendingRelicReward = true;
      return;
    }
    case "boss": {
      startCombat(state, pickBossEncounter(state.rng));
      return;
    }
    case "event": {
      const eventId = EVENT_POOL[nextInt(state.rng, EVENT_POOL.length)]!;
      state.event = { id: eventId };
      state.screen = "event";
      state.log.push("你踏进一处未知的房间。");
      return;
    }
    case "rest": {
      state.screen = "rest";
      state.log.push("你来到一处篝火。");
      return;
    }
    case "treasure": {
      grantTreasure(state);
      backToMap(state);
      return;
    }
    default: {
      // shop 尚未启用（未来里程碑）；保守回地图。
      backToMap(state);
    }
  }
}

/** 宝箱：优先给一个未持有的遗物，遗物都齐了则给金币兜底（复刻 StS 宝箱给遗物）。 */
function grantTreasure(state: GameState): void {
  const available = COMMON_RELIC_POOL.filter(id => !hasRelic(state, id));
  if (available.length > 0) {
    const id = available[nextInt(state.rng, available.length)]!;
    state.relics.push({ id, counter: 0 });
    state.log.push(`你打开宝箱，获得遗物「${getRelicDef(id).name}」。`);
    return;
  }
  const gold = nextRange(state.rng, TREASURE_GOLD_MIN, TREASURE_GOLD_MAX);
  state.gold += gold;
  state.log.push(`你打开宝箱，获得 ${gold} 金币。`);
}

/** 给一个未持有的普通遗物（精英 / 战斗掉落用）；都齐了给金币兜底。返回是否给了遗物。 */
export function grantRandomRelic(state: GameState): void {
  grantTreasure(state);
}

/** 结算完一个节点后回到地图选路屏。 */
export function backToMap(state: GameState): void {
  state.screen = "map";
}

/** 战斗后按概率掉药水（基础 40%，未掉逐场 +10、掉了 -10；槽满则不掉不调整）。 */
function rollPotionDrop(state: GameState): void {
  const emptySlot = state.potions.indexOf(null);
  if (emptySlot < 0) {
    return; // 槽满，不掉。
  }
  const chance = Math.max(0, Math.min(100, BASE_POTION_DROP_CHANCE + state.potionDropBonus));
  if (nextInt(state.rng, 100) < chance) {
    const id = POTION_DROP_POOL[nextInt(state.rng, POTION_DROP_POOL.length)]!;
    state.potions[emptySlot] = id;
    state.potionDropBonus -= 10;
    state.log.push(`你获得了药水「${getPotionDef(id).name}」。`);
  } else {
    state.potionDropBonus += 10;
  }
}

/** 非 Boss 战斗胜利后生成奖励：精英战先发一个遗物，掷药水掉落，再给三选一卡奖励。 */
export function generateReward(state: GameState): void {
  if (state.pendingRelicReward) {
    grantRandomRelic(state);
    state.pendingRelicReward = false;
  }
  rollPotionDrop(state);
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
  if (state.screen === "map") {
    return availableNext(state.map, state.currentNodeId).map(id => {
      const node = state.map.nodes[id]!;
      return `第${node.row + 1}层 ${NODE_TYPE_LABELS[node.type]}`;
    });
  }
  if (state.screen === "reward" && state.reward) {
    const cards = state.reward.cardChoices.map(choice => {
      const def = getCardDef(choice.defId);
      const cost = costOf(def, choice.upgraded);
      const desc = choice.upgraded ? def.upgradedDescription : def.description;
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
  if (state.screen === "event" && state.event) {
    return getEventDef(state.event.id).choices.map(choice => choice.label);
  }
  return [];
}

/** 结算一个事件结果（原地改 state）。金币/生命/牌组/遗物/药水复用既有系统。 */
function applyEventOutcome(state: GameState, outcome: EventOutcome): void {
  switch (outcome.kind) {
    case "gain_gold":
      state.gold += outcome.amount;
      break;
    case "lose_gold":
      state.gold = Math.max(0, state.gold - outcome.amount);
      break;
    case "heal":
      state.hp = Math.min(state.maxHp, state.hp + outcome.amount);
      break;
    case "lose_hp":
      // 事件不会致死：至少留 1 点生命（复刻 StS 事件不杀人）。
      state.hp = Math.max(1, state.hp - outcome.amount);
      break;
    case "gain_max_hp":
      state.maxHp += outcome.amount;
      state.hp += outcome.amount;
      break;
    case "add_card":
      state.deck.push({ uid: state.nextUid++, defId: outcome.cardId, upgraded: false });
      break;
    case "gain_relic":
      grantTreasure(state);
      break;
    case "gain_potion": {
      const slot = state.potions.indexOf(null);
      if (slot >= 0) {
        state.potions[slot] = POTION_DROP_POOL[nextInt(state.rng, POTION_DROP_POOL.length)]!;
      }
      break;
    }
    case "nothing":
      break;
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
    }
  }
}

function upgradableCards(state: GameState): GameState["deck"] {
  return state.deck.filter(card => !card.upgraded && getCardDef(card.defId).cost !== null);
}

export type ChooseResult = { ok: true } | { ok: false; reason: string };

export function applyChoose(state: GameState, optionIndex: number): ChooseResult {
  if (state.screen === "map") {
    const options = availableNext(state.map, state.currentNodeId);
    const nodeId = options[optionIndex];
    if (nodeId === undefined) {
      return { ok: false, reason: `选项 ${optionIndex} 无效。` };
    }
    resolveNode(state, state.map.nodes[nodeId]!);
    return { ok: true };
  }

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
    backToMap(state);
    return { ok: true };
  }

  if (state.screen === "event" && state.event) {
    const event = getEventDef(state.event.id);
    const choice = event.choices[optionIndex];
    if (!choice) {
      return { ok: false, reason: `选项 ${optionIndex} 无效。` };
    }
    for (const outcome of choice.outcomes) {
      applyEventOutcome(state, outcome);
    }
    state.log.push(choice.resultText);
    state.event = null;
    backToMap(state);
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
    backToMap(state);
    return { ok: true };
  }

  return { ok: false, reason: "当前屏幕没有可选项。" };
}
