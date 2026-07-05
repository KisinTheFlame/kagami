import type { CharacterId, Effect } from "../types.js";

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
  /** 角色专属：仅该角色的掉落 / 商店池里出现（省略=通用，任何角色可得）。 */
  characterLock?: CharacterId;
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

  // —— 补全批次：通用药水 ——
  {
    id: "poison_potion",
    name: "剧毒药水",
    description: "对一个敌人施加 6 层中毒。",
    rarity: "common",
    targeted: true,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "poison", amount: 6, on: "target" }],
  },
  {
    id: "heart_of_iron_potion",
    name: "铁心药水",
    description: "获得 6 层金属化（每回合结束获得 6 点格挡）。",
    rarity: "rare",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "metallicize", amount: 6, on: "self" }],
  },
  {
    id: "fruit_juice",
    name: "果汁",
    description: "永久提升 5 点最大生命，并回复 5 点生命。",
    rarity: "rare",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "gain_max_hp", amount: 5 }],
  },

  // —— 补全批次：角色专属药水 ——
  {
    id: "cunning_potion",
    name: "狡诈药水",
    description: "将 3 张飞刀加入手牌。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    characterLock: "silent",
    effects: [{ kind: "add_card", cardId: "shiv", pile: "hand", count: 3 }],
  },
  {
    id: "focus_potion",
    name: "集中药水",
    description: "获得 2 点集中（充能球效果 +2）。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    characterLock: "defect",
    effects: [{ kind: "apply_power", power: "focus", amount: 2, on: "self" }],
  },
  {
    id: "bottled_miracle",
    name: "瓶装奇迹",
    description: "将 2 张奇迹加入手牌。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    characterLock: "watcher",
    effects: [{ kind: "add_card", cardId: "miracle", pile: "hand", count: 2 }],
  },
  // —— 补全批次 2：牌生成 / 增益 / 姿态 / 球槽 ——
  {
    id: "attack_potion",
    name: "攻击药水",
    description: "将一张随机攻击牌加入手牌，本回合费用视为 0。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "add_random_card_free", pool: "attack" }],
  },
  {
    id: "skill_potion",
    name: "技能药水",
    description: "将一张随机技能牌加入手牌，本回合费用视为 0。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "add_random_card_free", pool: "skill" }],
  },
  {
    id: "power_potion",
    name: "能力药水",
    description: "将一张随机能力牌加入手牌，本回合费用视为 0。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "add_random_card_free", pool: "power" }],
  },
  {
    id: "colorless_potion",
    name: "无色药水",
    description: "将一张随机无色牌加入手牌。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "add_random_colorless", count: 1 }],
  },
  {
    id: "blessing_of_the_forge",
    name: "熔炉祝福",
    description: "升级本回合手牌中的所有牌。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "upgrade_hand_cards", all: true }],
  },
  {
    id: "flex_potion",
    name: "灵活药水",
    description: "获得 5 点力量，本回合结束时失去。",
    rarity: "common",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_strength_temp", amount: 5 }],
  },
  {
    id: "ghost_in_a_jar",
    name: "瓶中幽魂",
    description: "获得 1 层虚无缥缈（本回合受到的一切伤害降为 1）。",
    rarity: "rare",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "apply_power", power: "intangible", amount: 1, on: "self" }],
  },
  {
    id: "ambrosia",
    name: "神仙玉酿",
    description: "进入神性姿态。",
    rarity: "rare",
    targeted: false,
    combatOnly: true,
    characterLock: "watcher",
    effects: [{ kind: "enter_stance", stance: "divinity" }],
  },
  {
    id: "stance_potion",
    name: "姿态药水",
    description: "进入平静姿态。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    characterLock: "watcher",
    effects: [{ kind: "enter_stance", stance: "calm" }],
  },
  {
    id: "potion_of_capacity",
    name: "容量药水",
    description: "增加 2 个充能球槽。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    characterLock: "defect",
    effects: [{ kind: "change_orb_slots", delta: 2 }],
  },
  // —— 补全批次 3：牌堆操作 / 药水槽 ——
  {
    id: "liquid_memories",
    name: "流质记忆",
    description: "从弃牌堆取回一张牌到手牌，本回合费用视为 0（自动取最近弃掉的一张）。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "return_from_discard" }],
  },
  {
    id: "gamblers_brew",
    name: "赌徒酿",
    description: "弃掉手牌，抽取等量的牌。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "discard_hand_draw_same" }],
  },
  {
    id: "elixir_potion",
    name: "灵丹药水",
    description: "消耗手牌中所有非攻击牌。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "exhaust_non_attacks" }],
  },
  {
    id: "entropic_brew",
    name: "熵酿",
    description: "把你所有的空药水槽填满随机药水。",
    rarity: "uncommon",
    targeted: false,
    combatOnly: true,
    effects: [{ kind: "fill_potion_slots" }],
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

// 通用药水（无 characterLock）按稀有度取 id；角色专属药水由 character 参数单独并入。
function potionIdsOfRarity(rarity: PotionRarity): readonly string[] {
  return POTION_LIST.filter(
    potion => potion.rarity === rarity && potion.characterLock === undefined,
  ).map(potion => potion.id);
}

function potionIdsForCharacter(character: CharacterId, rarity: PotionRarity): readonly string[] {
  return POTION_LIST.filter(
    potion => potion.rarity === rarity && potion.characterLock === character,
  ).map(potion => potion.id);
}

export const COMMON_POTION_POOL: readonly string[] = potionIdsOfRarity("common");
export const RARE_POTION_POOL: readonly string[] = potionIdsOfRarity("rare");

/** 全部通用药水 id（不含角色专属）。 */
export const POTION_DROP_POOL: readonly string[] = POTION_LIST.filter(
  potion => potion.characterLock === undefined,
).map(potion => potion.id);

/** 取某稀有度的药水池；给了角色则并入该角色专属药水。 */
export function potionPoolOfRarity(
  rarity: PotionRarity,
  character?: CharacterId,
): readonly string[] {
  const base = potionIdsOfRarity(rarity);
  if (character === undefined) {
    return base;
  }
  return [...base, ...potionIdsForCharacter(character, rarity)];
}

/** 某角色实际可得的商店药水池 = 通用 + 该角色专属（全稀有度）。 */
export function shopPotionPool(character: CharacterId): readonly string[] {
  return [
    ...POTION_DROP_POOL,
    ...potionIdsForCharacter(character, "common"),
    ...potionIdsForCharacter(character, "uncommon"),
    ...potionIdsForCharacter(character, "rare"),
  ];
}

export const POTION_SLOTS = 3;
export const BASE_POTION_DROP_CHANCE = 40;
