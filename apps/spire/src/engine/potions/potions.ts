import type { Effect } from "../types.js";

// === 药水数据表 ===
//
// 药水 = 一次性道具，效果复用出牌的 Effect 解释器（玩家为行动者）。数值为功能性游戏规则
// （复刻杀戮尖塔 asc0），药水名为原创中文功能译名。targeted 的药水需要指定敌人目标。

export type PotionRarity = "common" | "uncommon" | "rare";

export type PotionDef = {
  id: string;
  name: string;
  description: string;
  rarity: PotionRarity;
  /** 需要指定一个敌人目标（火焰/虚弱/恐惧药水）。 */
  targeted: boolean;
  /** 只能在战斗中使用（多数如此；回血类可放宽，此切片统一战斗内用）。 */
  combatOnly: boolean;
  effects: Effect[];
};

const POTION_LIST: PotionDef[] = [
  {
    id: "block_potion",
    name: "格挡药水",
    description: "获得 12 点格挡。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "gain_block", amount: 12 }],
  },
  {
    id: "strength_potion",
    name: "力量药水",
    description: "获得 2 点力量。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "strength", amount: 2, on: "self" }],
  },
  {
    id: "dexterity_potion",
    name: "敏捷药水",
    description: "获得 2 点敏捷。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "dexterity", amount: 2, on: "self" }],
  },
  {
    id: "energy_potion",
    name: "能量药水",
    description: "获得 2 点能量。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "gain_energy", amount: 2 }],
  },
  {
    id: "swift_potion",
    name: "迅捷药水",
    description: "抽 3 张牌。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "draw", amount: 3 }],
  },
  {
    id: "fire_potion",
    name: "火焰药水",
    description: "对一个敌人造成 20 点伤害。",
    rarity: "common",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "deal_damage", amount: 20 }],
  },
  {
    id: "explosive_potion",
    name: "爆炸药水",
    description: "对所有敌人造成 10 点伤害。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "deal_damage_all", amount: 10 }],
  },
  {
    id: "weak_potion",
    name: "虚弱药水",
    description: "对一个敌人施加 3 层虚弱。",
    rarity: "common",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "weak", amount: 3, on: "target" }],
  },
  {
    id: "fear_potion",
    name: "恐惧药水",
    description: "对一个敌人施加 3 层易伤。",
    rarity: "common",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "vulnerable", amount: 3, on: "target" }],
  },
  {
    id: "blood_potion",
    name: "血之药水",
    description: "回复最大生命的 40%。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "heal_percent", percent: 40 }],
  },
  {
    id: "regen_potion",
    name: "回复药水",
    description: "获得 5 层再生（此后每回合结束回血，层数逐回合递减）。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "regen", amount: 5, on: "self" }],
  },
  {
    id: "essence_of_steel",
    name: "钢铁精华",
    description: "获得 4 层镀甲（每回合结束获得等量格挡；被穿甲攻击时递减）。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "plated_armor", amount: 4, on: "self" }],
  },
  {
    id: "ancient_potion",
    name: "远古药水",
    description: "获得 1 层神器（抵消下一个施加到你身上的减益）。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "artifact", amount: 1, on: "self" }],
  },
  {
    id: "liquid_bronze",
    name: "液态青铜",
    description: "获得 3 层荆棘（被攻击时反弹 3 点伤害）。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "thorns", amount: 3, on: "self" }],
  },
  {
    id: "cultist_potion",
    name: "邪教徒药水",
    description: "获得 1 层仪式（每回合开始获得 1 点力量）。",
    rarity: "rare",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "ritual", amount: 1, on: "self" }],
  },
];

const POTION_MAP: ReadonlyMap<string, PotionDef> = new Map(
  POTION_LIST.map(potion => [potion.id, potion]),
);

export const ALL_POTIONS: readonly PotionDef[] = POTION_LIST;

export function getPotionDef(id: string): PotionDef {
  const def = POTION_MAP.get(id);
  if (!def) {
    throw new Error(`未知药水 id: ${id}`);
  }
  return def;
}

function potionIdsOfRarity(rarity: PotionRarity): readonly string[] {
  return POTION_LIST.filter(potion => potion.rarity === rarity).map(potion => potion.id);
}

export const COMMON_POTION_POOL: readonly string[] = potionIdsOfRarity("common");
export const UNCOMMON_POTION_POOL: readonly string[] = potionIdsOfRarity("uncommon");
export const RARE_POTION_POOL: readonly string[] = potionIdsOfRarity("rare");

/** 全部药水 id（商店 / 无视稀有度场景用）。 */
export const POTION_DROP_POOL: readonly string[] = POTION_LIST.map(potion => potion.id);

/** 取某稀有度的药水池。 */
export function potionPoolOfRarity(rarity: PotionRarity): readonly string[] {
  if (rarity === "rare") {
    return RARE_POTION_POOL;
  }
  if (rarity === "uncommon") {
    return UNCOMMON_POTION_POOL;
  }
  return COMMON_POTION_POOL;
}

export const POTION_SLOTS = 3;
export const BASE_POTION_DROP_CHANCE = 40;
