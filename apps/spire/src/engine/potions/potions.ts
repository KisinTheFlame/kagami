import type { Effect } from "../types.js";

// === 药水数据表 ===
//
// 药水 = 一次性道具，效果复用出牌的 Effect 解释器（玩家为行动者）。数值为功能性游戏规则
// （复刻杀戮尖塔 asc0），药水名为原创中文功能译名。targeted 的药水需要指定敌人目标。

export type PotionDef = {
  id: string;
  name: string;
  description: string;
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
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "gain_block", amount: 12 }],
  },
  {
    id: "strength_potion",
    name: "力量药水",
    description: "获得 2 点力量。",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "strength", amount: 2, on: "self" }],
  },
  {
    id: "dexterity_potion",
    name: "敏捷药水",
    description: "获得 2 点敏捷。",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "dexterity", amount: 2, on: "self" }],
  },
  {
    id: "energy_potion",
    name: "能量药水",
    description: "获得 2 点能量。",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "gain_energy", amount: 2 }],
  },
  {
    id: "swift_potion",
    name: "迅捷药水",
    description: "抽 3 张牌。",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "draw", amount: 3 }],
  },
  {
    id: "fire_potion",
    name: "火焰药水",
    description: "对一个敌人造成 20 点伤害。",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "deal_damage", amount: 20 }],
  },
  {
    id: "explosive_potion",
    name: "爆炸药水",
    description: "对所有敌人造成 10 点伤害。",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "deal_damage_all", amount: 10 }],
  },
  {
    id: "weak_potion",
    name: "虚弱药水",
    description: "对一个敌人施加 3 层虚弱。",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "weak", amount: 3, on: "target" }],
  },
  {
    id: "fear_potion",
    name: "恐惧药水",
    description: "对一个敌人施加 3 层易伤。",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "vulnerable", amount: 3, on: "target" }],
  },
  {
    id: "blood_potion",
    name: "血之药水",
    description: "回复最大生命的 40%。",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "heal_percent", percent: 40 }],
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

/** 掉落池（当前全为 common）。 */
export const POTION_DROP_POOL: readonly string[] = POTION_LIST.map(potion => potion.id);

export const POTION_SLOTS = 3;
export const BASE_POTION_DROP_CHANCE = 40;
