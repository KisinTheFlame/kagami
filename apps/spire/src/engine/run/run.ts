import type { GameState, MapNode, MapNodeType } from "../types.js";
import { cardPoolOf, getCardDef, costOf } from "../cards/cards.js";
import { getCharacterConfig } from "../characters/characters.js";
import { pickBossEncounter, pickEliteEncounter, pickNormalEncounter } from "../enemies/enemies.js";
import { rewardRelicPool, getRelicDef, hasRelic } from "../relics/relics.js";
import {
  BASE_POTION_DROP_CHANCE,
  POTION_DROP_POOL,
  getPotionDef,
  potionPoolOfRarity,
} from "../potions/potions.js";
import { EVENT_POOL, getEventDef } from "../events/events.js";
import type { EventOutcome } from "../events/events.js";
import { generateShop } from "../shop/shop.js";
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
// 战斗胜利金币区间（对齐 StS asc0）。
const NORMAL_GOLD_MIN = 10;
const NORMAL_GOLD_MAX = 20;
const ELITE_GOLD_MIN = 25;
const ELITE_GOLD_MAX = 35;

/** 启用的地图节点类型（全类型齐备）。 */
const ENABLED_MAP_TYPES: readonly MapNodeType[] = [
  "combat",
  "elite",
  "event",
  "shop",
  "rest",
  "treasure",
];

const RARITY_LABELS: Record<string, string> = {
  common: "普通",
  uncommon: "罕见",
  rare: "稀有",
  starter: "起始",
  special: "特殊",
};

const NODE_TYPE_LABELS: Record<MapNodeType, string> = {
  combat: "战斗",
  elite: "精英",
  event: "未知",
  rest: "篝火",
  shop: "商店",
  treasure: "宝箱",
  boss: "首领",
};

/** 有内容的幕数：打完第 TOTAL_ACTS 幕 Boss 即通关；之前的 Boss 则进入下一幕。 */
export const TOTAL_ACTS = 3;

export function buildMap(state: GameState): void {
  state.map = generateMap(state.rng, ENABLED_MAP_TYPES);
  state.currentNodeId = null;
  state.screen = "map";
}

/** 进入下一幕：幕号 +1、重置本幕战斗计数、生成新地图，携带血/牌/遗物/金币/药水。 */
export function advanceToNextAct(state: GameState): void {
  state.act += 1;
  state.combatsEntered = 0;
  buildMap(state);
  state.log.push(`你踏入第 ${state.act} 幕。`);
}

/** 进入一个地图节点：按类型路由。战斗/Boss 起战斗；篝火切 rest 屏；宝箱即时给金币后回地图。 */
function resolveNode(state: GameState, node: MapNode): void {
  state.currentNodeId = node.id;
  switch (node.type) {
    case "combat": {
      // 前若干场抽 weak 池、其余抽 strong 池（复刻 StS Act1 战斗节奏）。
      const encounterId = pickNormalEncounter(state.rng, state.combatsEntered, state.act);
      state.combatsEntered += 1;
      startCombat(state, encounterId);
      return;
    }
    case "elite": {
      // 精英战：独立精英池；胜利后必发 1 个遗物。
      startCombat(state, pickEliteEncounter(state.rng, state.act));
      state.pendingRelicReward = true;
      return;
    }
    case "boss": {
      startCombat(state, pickBossEncounter(state.rng, state.act));
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
    case "shop": {
      generateShop(state);
      state.log.push("你走进一间商店。");
      return;
    }
    case "treasure": {
      grantTreasure(state);
      backToMap(state);
      return;
    }
    default: {
      // 所有节点类型已启用；保守回地图兜底。
      backToMap(state);
    }
  }
}

/** 宝箱：优先给一个未持有的遗物，遗物都齐了则给金币兜底（复刻 StS 宝箱给遗物）。 */
function grantTreasure(state: GameState): void {
  const available = rewardRelicPool(state.character).filter(id => !hasRelic(state, id));
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
    // 掷稀有度（稀有 5% / 罕见 30% / 普通 65%），再从该档抽一瓶。
    const roll = nextInt(state.rng, 100);
    const rarity = roll < 5 ? "rare" : roll < 35 ? "uncommon" : "common";
    const pool = potionPoolOfRarity(rarity);
    const id = pool[nextInt(state.rng, pool.length)]!;
    state.potions[emptySlot] = id;
    state.potionDropBonus -= 10;
    state.log.push(`你获得了药水「${getPotionDef(id).name}」。`);
  } else {
    state.potionDropBonus += 10;
  }
}

/** 非 Boss 战斗胜利后生成奖励：精英战先发一个遗物，掷药水掉落，再给三选一卡奖励。 */
export function generateReward(state: GameState): void {
  const isElite = state.pendingRelicReward;
  if (state.pendingRelicReward) {
    grantRandomRelic(state);
    state.pendingRelicReward = false;
  }
  // 战斗胜利掉金币（普通 10-20 / 精英 25-35，对齐 StS）。
  const gold = isElite
    ? nextRange(state.rng, ELITE_GOLD_MIN, ELITE_GOLD_MAX)
    : nextRange(state.rng, NORMAL_GOLD_MIN, NORMAL_GOLD_MAX);
  state.gold += gold;
  state.log.push(`战斗胜利，获得 ${gold} 金币。`);
  rollPotionDrop(state);
  const choices: { defId: string; upgraded: boolean }[] = [];
  const picked = new Set<string>();
  for (let i = 0; i < REWARD_CARD_COUNT; i += 1) {
    const defId = rollRewardCard(state, picked);
    if (defId === null) {
      break;
    }
    picked.add(defId);
    choices.push({ defId, upgraded: false });
  }
  state.reward = { cardChoices: choices };
  state.screen = "reward";
}

/** 掷一张奖励卡：先掷稀有度（稀有 4% / 罕见 36% / 普通 60%），再从本角色该档池里挑未重复的。 */
function rollRewardCard(state: GameState, exclude: ReadonlySet<string>): string | null {
  const color = getCharacterConfig(state.character).color;
  const roll = nextInt(state.rng, 100);
  const rarity = roll < 4 ? "rare" : roll < 40 ? "uncommon" : "common";
  // 依次尝试目标档 → 降级兜底，保证总能给出一张不重复的卡。
  for (const tier of [rarity, "uncommon", "common"] as const) {
    const candidates = cardPoolOf(color, tier).filter(id => !exclude.has(id));
    if (candidates.length > 0) {
      return candidates[nextInt(state.rng, candidates.length)]!;
    }
  }
  return null;
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
      const rarity = RARITY_LABELS[def.rarity] ?? "";
      return `[${rarity}] ${def.name}${choice.upgraded ? "+" : ""} 费${cost ?? "-"} · ${desc}`;
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
  if (state.screen === "shop" && state.shop) {
    // 去牌子界面：列可移除的牌 + 取消。
    if (state.shop.removing) {
      const cards = state.deck.map(card => {
        const def = getCardDef(card.defId);
        return `移除「${def.name}${card.upgraded ? "+" : ""}」`;
      });
      cards.push("取消");
      return cards;
    }
    const options = state.shop.items.map(item => {
      const name = shopItemName(item);
      if (item.sold) {
        return `${name}（已售罄）`;
      }
      const affordable = state.gold >= item.cost ? "" : "（金币不足）";
      return `${name} — ${item.cost} 金${affordable}`;
    });
    const purge = state.shop.purgeUsed
      ? "去牌服务（已用过）"
      : `移除一张牌 — ${state.shop.purgeCost} 金${state.gold >= state.shop.purgeCost ? "" : "（金币不足）"}`;
    options.push(purge, "离开商店");
    return options;
  }
  return [];
}

/** 商店商品的展示名（卡/遗物/药水）。 */
function shopItemName(item: NonNullable<GameState["shop"]>["items"][number]): string {
  if (item.kind === "card") {
    return `牌·${getCardDef(item.defId).name}`;
  }
  if (item.kind === "relic") {
    return `遗物·${getRelicDef(item.id).name}`;
  }
  return `药水·${getPotionDef(item.id).name}`;
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

/** 购买一件商店商品：校验售罄/金币/药水槽 → 扣金币、入库、标记售罄，留在商店屏。 */
function buyShopItem(
  state: GameState,
  item: NonNullable<GameState["shop"]>["items"][number],
): ChooseResult {
  if (item.sold) {
    return { ok: false, reason: "这件商品已经卖掉了。" };
  }
  if (state.gold < item.cost) {
    return { ok: false, reason: `金币不足：需 ${item.cost}，你只有 ${state.gold}。` };
  }
  if (item.kind === "potion" && state.potions.indexOf(null) < 0) {
    return { ok: false, reason: "药水槽已满，先用掉一瓶再买。" };
  }

  state.gold -= item.cost;
  item.sold = true;
  if (item.kind === "card") {
    state.deck.push({ uid: state.nextUid++, defId: item.defId, upgraded: false });
    state.log.push(`你买下了牌「${getCardDef(item.defId).name}」。`);
  } else if (item.kind === "relic") {
    state.relics.push({ id: item.id, counter: 0 });
    state.log.push(`你买下了遗物「${getRelicDef(item.id).name}」。`);
  } else {
    state.potions[state.potions.indexOf(null)] = item.id;
    state.log.push(`你买下了药水「${getPotionDef(item.id).name}」。`);
  }
  return { ok: true };
}

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

  if (state.screen === "shop" && state.shop) {
    const shop = state.shop;
    // 去牌子界面：选一张牌移除，或取消。
    if (shop.removing) {
      if (optionIndex === state.deck.length) {
        shop.removing = false;
        return { ok: true };
      }
      const card = state.deck[optionIndex];
      if (!card) {
        return { ok: false, reason: `选项 ${optionIndex} 无效。` };
      }
      state.gold -= shop.purgeCost;
      state.deck.splice(optionIndex, 1);
      shop.purgeUsed = true;
      shop.removing = false;
      state.log.push(`你花 ${shop.purgeCost} 金移除了「${getCardDef(card.defId).name}」。`);
      return { ok: true };
    }
    const items = shop.items;
    if (optionIndex < items.length) {
      return buyShopItem(state, items[optionIndex]!);
    }
    if (optionIndex === items.length) {
      // 去牌服务：进入选牌子界面。
      if (shop.purgeUsed) {
        return { ok: false, reason: "本店的去牌服务已经用过了。" };
      }
      if (state.gold < shop.purgeCost) {
        return { ok: false, reason: `金币不足：去牌需 ${shop.purgeCost}，你只有 ${state.gold}。` };
      }
      if (state.deck.length === 0) {
        return { ok: false, reason: "牌组里没有可移除的牌。" };
      }
      shop.removing = true;
      return { ok: true };
    }
    if (optionIndex === items.length + 1) {
      state.shop = null;
      backToMap(state);
      return { ok: true };
    }
    return { ok: false, reason: `选项 ${optionIndex} 无效。` };
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
