import type { CardDef } from "../types.js";

// === 卡定义数据表（铁甲战士 · 切片子集）===
//
// 数值为功能性游戏规则（复刻杀戮尖塔的机制数值）；卡面文案为原创中文。
// 加卡加怪基本是往这张表填数据行，不改引擎逻辑。

const CARD_LIST: CardDef[] = [
  // —— 起始牌组 ——
  {
    id: "strike",
    name: "打击",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [{ kind: "deal_damage", amount: 6 }],
    upgradedEffects: [{ kind: "deal_damage", amount: 9 }],
    description: "造成 6 点伤害。",
    upgradedDescription: "造成 9 点伤害。",
  },
  {
    id: "defend",
    name: "防御",
    type: "skill",
    cost: 1,
    targeted: false,
    exhausts: false,
    effects: [{ kind: "gain_block", amount: 5 }],
    upgradedEffects: [{ kind: "gain_block", amount: 8 }],
    description: "获得 5 点格挡。",
    upgradedDescription: "获得 8 点格挡。",
  },
  {
    id: "bash",
    name: "痛击",
    type: "attack",
    cost: 2,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "deal_damage", amount: 8 },
      { kind: "apply_power", power: "vulnerable", amount: 2, on: "target" },
    ],
    upgradedEffects: [
      { kind: "deal_damage", amount: 10 },
      { kind: "apply_power", power: "vulnerable", amount: 3, on: "target" },
    ],
    description: "造成 8 点伤害。给予 2 层易伤。",
    upgradedDescription: "造成 10 点伤害。给予 3 层易伤。",
  },

  // —— 切片普通卡池（奖励可得）——
  {
    id: "anger",
    name: "愤怒",
    type: "attack",
    cost: 0,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "deal_damage", amount: 6 },
      { kind: "add_card", cardId: "anger", pile: "discard", count: 1 },
    ],
    upgradedEffects: [
      { kind: "deal_damage", amount: 8 },
      { kind: "add_card", cardId: "anger", pile: "discard", count: 1 },
    ],
    description: "造成 6 点伤害。将一张本牌置入弃牌堆。",
    upgradedDescription: "造成 8 点伤害。将一张本牌置入弃牌堆。",
  },
  {
    id: "cleave",
    name: "横扫",
    type: "attack",
    cost: 1,
    targeted: false,
    exhausts: false,
    effects: [{ kind: "deal_damage_all", amount: 8 }],
    upgradedEffects: [{ kind: "deal_damage_all", amount: 11 }],
    description: "对所有敌人造成 8 点伤害。",
    upgradedDescription: "对所有敌人造成 11 点伤害。",
  },
  {
    id: "clothesline",
    name: "铁臂勾拳",
    type: "attack",
    cost: 2,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "deal_damage", amount: 12 },
      { kind: "apply_power", power: "weak", amount: 2, on: "target" },
    ],
    upgradedEffects: [
      { kind: "deal_damage", amount: 14 },
      { kind: "apply_power", power: "weak", amount: 3, on: "target" },
    ],
    description: "造成 12 点伤害。给予 2 层虚弱。",
    upgradedDescription: "造成 14 点伤害。给予 3 层虚弱。",
  },
  {
    id: "iron_wave",
    name: "铁浪",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "gain_block", amount: 5 },
      { kind: "deal_damage", amount: 5 },
    ],
    upgradedEffects: [
      { kind: "gain_block", amount: 7 },
      { kind: "deal_damage", amount: 7 },
    ],
    description: "获得 5 点格挡。造成 5 点伤害。",
    upgradedDescription: "获得 7 点格挡。造成 7 点伤害。",
  },
  {
    id: "pommel_strike",
    name: "剑柄打击",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "deal_damage", amount: 9 },
      { kind: "draw", amount: 1 },
    ],
    upgradedEffects: [
      { kind: "deal_damage", amount: 10 },
      { kind: "draw", amount: 2 },
    ],
    description: "造成 9 点伤害。抽 1 张牌。",
    upgradedDescription: "造成 10 点伤害。抽 2 张牌。",
  },
  {
    id: "twin_strike",
    name: "双重打击",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [{ kind: "deal_damage_multi", amount: 5, times: 2 }],
    upgradedEffects: [{ kind: "deal_damage_multi", amount: 7, times: 2 }],
    description: "造成 5 点伤害两次。",
    upgradedDescription: "造成 7 点伤害两次。",
  },
  {
    id: "shrug_it_off",
    name: "泰然自若",
    type: "skill",
    cost: 1,
    targeted: false,
    exhausts: false,
    effects: [
      { kind: "gain_block", amount: 8 },
      { kind: "draw", amount: 1 },
    ],
    upgradedEffects: [
      { kind: "gain_block", amount: 11 },
      { kind: "draw", amount: 1 },
    ],
    description: "获得 8 点格挡。抽 1 张牌。",
    upgradedDescription: "获得 11 点格挡。抽 1 张牌。",
  },
  {
    id: "body_slam",
    name: "力压",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [{ kind: "deal_damage_equal_to_block" }],
    upgradedEffects: [{ kind: "deal_damage_equal_to_block" }],
    description: "造成等同于当前格挡值的伤害。",
    upgradedDescription: "费用降为 0。造成等同于当前格挡值的伤害。",
  },
  {
    id: "thunderclap",
    name: "疾雷",
    type: "attack",
    cost: 1,
    targeted: false,
    exhausts: false,
    effects: [
      { kind: "deal_damage_all", amount: 4 },
      { kind: "apply_power", power: "vulnerable", amount: 1, on: "all_enemies" },
    ],
    upgradedEffects: [
      { kind: "deal_damage_all", amount: 7 },
      { kind: "apply_power", power: "vulnerable", amount: 1, on: "all_enemies" },
    ],
    description: "对所有敌人造成 4 点伤害并给予 1 层易伤。",
    upgradedDescription: "对所有敌人造成 7 点伤害并给予 1 层易伤。",
  },

  // —— 扩充普通/罕见/稀有卡池（M2a）——
  {
    id: "heavy_blade",
    name: "重刃",
    type: "attack",
    cost: 2,
    targeted: true,
    exhausts: false,
    effects: [{ kind: "deal_damage", amount: 14, strengthMultiplier: 3 }],
    upgradedEffects: [{ kind: "deal_damage", amount: 14, strengthMultiplier: 5 }],
    description: "造成 14 点伤害。力量对本牌的加成提升至 3 倍。",
    upgradedDescription: "造成 14 点伤害。力量对本牌的加成提升至 5 倍。",
  },
  {
    id: "uppercut",
    name: "上勾拳",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "deal_damage", amount: 13 },
      { kind: "apply_power", power: "weak", amount: 1, on: "target" },
      { kind: "apply_power", power: "vulnerable", amount: 1, on: "target" },
    ],
    upgradedEffects: [
      { kind: "deal_damage", amount: 13 },
      { kind: "apply_power", power: "weak", amount: 2, on: "target" },
      { kind: "apply_power", power: "vulnerable", amount: 2, on: "target" },
    ],
    description: "造成 13 点伤害。给予 1 层虚弱、1 层易伤。",
    upgradedDescription: "造成 13 点伤害。给予 2 层虚弱、2 层易伤。",
  },
  {
    id: "hemokinesis",
    name: "血魔法",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "lose_hp", amount: 2 },
      { kind: "deal_damage", amount: 15 },
    ],
    upgradedEffects: [
      { kind: "lose_hp", amount: 2 },
      { kind: "deal_damage", amount: 20 },
    ],
    description: "失去 2 点生命。造成 15 点伤害。",
    upgradedDescription: "失去 2 点生命。造成 20 点伤害。",
  },
  {
    id: "pummel",
    name: "乱拳",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: true,
    effects: [{ kind: "deal_damage_multi", amount: 2, times: 4 }],
    upgradedEffects: [{ kind: "deal_damage_multi", amount: 2, times: 5 }],
    description: "造成 2 点伤害 4 次。消耗。",
    upgradedDescription: "造成 2 点伤害 5 次。消耗。",
  },
  {
    id: "bludgeon",
    name: "重锤",
    type: "attack",
    cost: 3,
    targeted: true,
    exhausts: false,
    effects: [{ kind: "deal_damage", amount: 32 }],
    upgradedEffects: [{ kind: "deal_damage", amount: 42 }],
    description: "造成 32 点伤害。",
    upgradedDescription: "造成 42 点伤害。",
  },
  {
    id: "wild_strike",
    name: "狂野劈砍",
    type: "attack",
    cost: 1,
    targeted: true,
    exhausts: false,
    effects: [
      { kind: "deal_damage", amount: 12 },
      { kind: "add_card", cardId: "wound", pile: "draw", count: 1 },
    ],
    upgradedEffects: [
      { kind: "deal_damage", amount: 17 },
      { kind: "add_card", cardId: "wound", pile: "draw", count: 1 },
    ],
    description: "造成 12 点伤害。将一张「伤口」洗入抽牌堆。",
    upgradedDescription: "造成 17 点伤害。将一张「伤口」洗入抽牌堆。",
  },
  {
    id: "sword_boomerang",
    name: "剑刃回旋镖",
    type: "attack",
    cost: 1,
    targeted: false,
    exhausts: false,
    effects: [{ kind: "deal_damage_random", amount: 3, times: 3 }],
    upgradedEffects: [{ kind: "deal_damage_random", amount: 3, times: 4 }],
    description: "对随机敌人造成 3 点伤害 3 次。",
    upgradedDescription: "对随机敌人造成 3 点伤害 4 次。",
  },
  {
    id: "inflame",
    name: "燃怒",
    type: "power",
    cost: 1,
    targeted: false,
    exhausts: false,
    effects: [{ kind: "apply_power", power: "strength", amount: 2, on: "self" }],
    upgradedEffects: [{ kind: "apply_power", power: "strength", amount: 3, on: "self" }],
    description: "获得 2 点力量。",
    upgradedDescription: "获得 3 点力量。",
  },

  // —— 敌人塞进牌组的废牌 / 伤口（不可打出）——
  {
    id: "wound",
    name: "伤口",
    type: "status",
    cost: null,
    targeted: false,
    exhausts: false,
    effects: [],
    upgradedEffects: [],
    description: "状态牌，无法打出。占用手牌，本场战斗结束后消失。",
    upgradedDescription: "状态牌，无法打出。占用手牌，本场战斗结束后消失。",
  },
  {
    id: "slimed",
    name: "泥泞",
    type: "status",
    cost: null,
    targeted: false,
    exhausts: true,
    effects: [],
    upgradedEffects: [],
    description: "状态牌，无法打出。留在手里占位，本场战斗结束后消失。",
    upgradedDescription: "状态牌，无法打出。留在手里占位，本场战斗结束后消失。",
  },
];

/** 全部卡定义（lookup / 参考查询用）。 */
export const ALL_CARDS: readonly CardDef[] = CARD_LIST;

const CARD_MAP: ReadonlyMap<string, CardDef> = new Map(CARD_LIST.map(card => [card.id, card]));

export function getCardDef(id: string): CardDef {
  const def = CARD_MAP.get(id);
  if (!def) {
    throw new Error(`未知卡牌 id: ${id}`);
  }
  return def;
}

/** 铁甲战士起始牌组：打击 ×5、防御 ×4、痛击 ×1。 */
export const IRONCLAD_STARTER_DECK: readonly string[] = [
  "strike",
  "strike",
  "strike",
  "strike",
  "strike",
  "defend",
  "defend",
  "defend",
  "defend",
  "bash",
];

/** 卡奖励池（不含起始专属与废牌）：三选一从这里抽。 */
export const REWARD_CARD_POOL: readonly string[] = [
  "anger",
  "cleave",
  "clothesline",
  "iron_wave",
  "pommel_strike",
  "twin_strike",
  "shrug_it_off",
  "body_slam",
  "thunderclap",
  "heavy_blade",
  "uppercut",
  "hemokinesis",
  "pummel",
  "bludgeon",
  "wild_strike",
  "sword_boomerang",
  "inflame",
];

/** 取一张牌当前生效的效果（升级则用升级效果）。 */
export function effectsOf(def: CardDef, upgraded: boolean): CardDef["effects"] {
  return upgraded ? def.upgradedEffects : def.effects;
}

/** 取一张牌当前生效的费用（力压升级后降为 0）。 */
export function costOf(def: CardDef, upgraded: boolean): number | null {
  if (def.cost === null) {
    return null;
  }
  if (def.id === "body_slam" && upgraded) {
    return 0;
  }
  return def.cost;
}
