import type { EnemyDef, RngState } from "../types.js";
import { nextFloat } from "../rng.js";

// === 敌人定义数据表（第一幕切片）===
//
// 血量区间、出招数值为功能性游戏规则；意图选择规则显式、可被种子 RNG 驱动（issue #234 C8）。
// 出招名称为原创中文。精确权重 / 连续限制 / 守卫者阈值待真机 ground truth 校准（见设计文档 Assignment）。

const ENEMY_LIST: EnemyDef[] = [
  {
    id: "cultist",
    name: "邪教徒",
    hpMin: 48,
    hpMax: 54,
    moves: [
      {
        id: "incantation",
        name: "仪式咏唱",
        effects: [{ kind: "apply_power", power: "ritual", amount: 3, on: "self" }],
        intent: "buff",
      },
      {
        id: "dark_strike",
        name: "暗袭",
        effects: [{ kind: "deal_damage", amount: 6 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: ["incantation"],
      weighted: [{ move: "dark_strike", weight: 1, maxInARow: 99 }],
    },
  },
  {
    id: "jaw_worm",
    name: "颚虫",
    hpMin: 40,
    hpMax: 44,
    moves: [
      {
        id: "chomp",
        name: "撕咬",
        effects: [{ kind: "deal_damage", amount: 11 }],
        intent: "attack",
      },
      {
        id: "thrash",
        name: "猛击",
        effects: [
          { kind: "deal_damage", amount: 7 },
          { kind: "gain_block", amount: 5 },
        ],
        intent: "attack",
      },
      {
        id: "bellow",
        name: "咆哮",
        effects: [
          { kind: "apply_power", power: "strength", amount: 3, on: "self" },
          { kind: "gain_block", amount: 6 },
        ],
        intent: "buff",
      },
    ],
    intentRule: {
      scripted: ["chomp"],
      weighted: [
        { move: "bellow", weight: 45, maxInARow: 1 },
        { move: "thrash", weight: 30, maxInARow: 2 },
        { move: "chomp", weight: 25, maxInARow: 1 },
      ],
    },
  },
  {
    id: "louse",
    name: "红虱",
    hpMin: 10,
    hpMax: 15,
    moves: [
      {
        id: "bite",
        // 咬击基础伤害在出生时掷定（5~7）、整场固定，见 startCombat 的 rolledDamage。
        name: "啃咬",
        effects: [{ kind: "deal_damage_rolled" }],
        intent: "attack",
      },
      {
        id: "grow",
        name: "强化",
        effects: [{ kind: "apply_power", power: "strength", amount: 3, on: "self" }],
        intent: "buff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "bite", weight: 75, maxInARow: 2 },
        { move: "grow", weight: 25, maxInARow: 2 },
      ],
    },
  },
  {
    id: "acid_slime_m",
    name: "酸液史莱姆（中）",
    hpMin: 28,
    hpMax: 32,
    moves: [
      {
        id: "corrosive_spit",
        name: "腐蚀喷吐",
        effects: [
          { kind: "deal_damage", amount: 7 },
          { kind: "add_card", cardId: "slimed", pile: "discard", count: 1 },
        ],
        intent: "attack",
      },
      {
        id: "lick",
        name: "舔舐",
        effects: [{ kind: "apply_power", power: "weak", amount: 1, on: "target" }],
        intent: "debuff",
      },
      {
        id: "tackle",
        name: "冲撞",
        effects: [{ kind: "deal_damage", amount: 10 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "corrosive_spit", weight: 30, maxInARow: 2 },
        { move: "tackle", weight: 40, maxInARow: 1 },
        { move: "lick", weight: 30, maxInARow: 2 },
      ],
    },
  },

  {
    id: "spike_slime_m",
    name: "尖刺史莱姆（中）",
    hpMin: 28,
    hpMax: 32,
    moves: [
      {
        id: "flame_tackle",
        name: "扑击",
        effects: [
          { kind: "deal_damage", amount: 8 },
          { kind: "add_card", cardId: "slimed", pile: "discard", count: 1 },
        ],
        intent: "attack",
      },
      {
        id: "lick_frail",
        name: "舔舐",
        effects: [{ kind: "apply_power", power: "frail", amount: 1, on: "target" }],
        intent: "debuff",
      },
    ],
    // asc0（sts_lightspeed getMoveForRoll）：roll<30→扑击、否则舔舐；同招最多连两次。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "flame_tackle", weight: 30, maxInARow: 2 },
        { move: "lick_frail", weight: 70, maxInARow: 2 },
      ],
    },
  },
  {
    id: "spike_slime_s",
    name: "尖刺史莱姆（小）",
    hpMin: 10,
    hpMax: 14,
    moves: [
      {
        id: "tackle_s",
        name: "冲撞",
        effects: [{ kind: "deal_damage", amount: 5 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [{ move: "tackle_s", weight: 1, maxInARow: 99 }],
    },
  },
  {
    id: "acid_slime_s",
    name: "酸液史莱姆（小）",
    hpMin: 8,
    hpMax: 12,
    moves: [
      {
        id: "tackle_acid_s",
        name: "冲撞",
        effects: [{ kind: "deal_damage", amount: 3 }],
        intent: "attack",
      },
      {
        id: "lick_weak",
        name: "舔舐",
        effects: [{ kind: "apply_power", power: "weak", amount: 1, on: "target" }],
        intent: "debuff",
      },
    ],
    // asc0：首招 50/50，其后严格交替（sts_lightspeed 用 setMove 锁定）；
    // 两招 + maxInARow 1 在本框架下等价复现该交替观感。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "tackle_acid_s", weight: 50, maxInARow: 1 },
        { move: "lick_weak", weight: 50, maxInARow: 1 },
      ],
    },
  },
  {
    id: "blue_slaver",
    name: "蓝色奴隶主",
    hpMin: 46,
    hpMax: 50,
    moves: [
      {
        id: "stab",
        name: "刺击",
        effects: [{ kind: "deal_damage", amount: 12 }],
        intent: "attack",
      },
      {
        id: "rake",
        name: "耙击",
        effects: [
          { kind: "deal_damage", amount: 7 },
          { kind: "apply_power", power: "weak", amount: 1, on: "target" },
        ],
        intent: "attack",
      },
    ],
    // asc0：roll>=40→刺击、否则耙击；两招各最多连两次（sts_lightspeed lastTwoMoves）。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "stab", weight: 60, maxInARow: 2 },
        { move: "rake", weight: 40, maxInARow: 2 },
      ],
    },
  },

  {
    id: "fungi_beast",
    name: "真菌兽",
    hpMin: 22,
    hpMax: 28,
    deathEffects: [{ kind: "apply_power", power: "vulnerable", amount: 2, on: "target" }],
    moves: [
      {
        id: "fungi_bite",
        name: "撕咬",
        effects: [{ kind: "deal_damage", amount: 6 }],
        intent: "attack",
      },
      {
        id: "fungi_grow",
        name: "成长",
        effects: [{ kind: "apply_power", power: "strength", amount: 3, on: "self" }],
        intent: "buff",
      },
    ],
    // 连两次撕咬后强制成长；刚成长完回撕咬；否则随机（近似权重）。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "fungi_bite", weight: 60, maxInARow: 2 },
        { move: "fungi_grow", weight: 40, maxInARow: 1 },
      ],
    },
  },

  // —— 地精帮（狂暴/鬼祟/肥胖/护盾/巫师）——
  {
    id: "mad_gremlin",
    name: "狂暴地精",
    hpMin: 20,
    hpMax: 24,
    moves: [
      {
        id: "scratch",
        name: "抓挠",
        effects: [{ kind: "deal_damage", amount: 4 }],
        intent: "attack",
      },
    ],
    intentRule: { scripted: [], weighted: [{ move: "scratch", weight: 1, maxInARow: 99 }] },
  },
  {
    id: "sneaky_gremlin",
    name: "鬼祟地精",
    hpMin: 10,
    hpMax: 14,
    moves: [
      {
        id: "puncture",
        name: "穿刺",
        effects: [{ kind: "deal_damage", amount: 9 }],
        intent: "attack",
      },
    ],
    intentRule: { scripted: [], weighted: [{ move: "puncture", weight: 1, maxInARow: 99 }] },
  },
  {
    id: "fat_gremlin",
    name: "肥胖地精",
    hpMin: 13,
    hpMax: 17,
    moves: [
      {
        id: "smash",
        name: "猛击",
        effects: [
          { kind: "deal_damage", amount: 4 },
          { kind: "apply_power", power: "weak", amount: 1, on: "target" },
        ],
        intent: "attack",
      },
    ],
    intentRule: { scripted: [], weighted: [{ move: "smash", weight: 1, maxInARow: 99 }] },
  },
  {
    id: "shield_gremlin",
    name: "护盾地精",
    hpMin: 12,
    hpMax: 15,
    moves: [
      {
        id: "protect",
        name: "保护",
        effects: [{ kind: "gain_block_ally", amount: 7 }],
        intent: "defend",
      },
      {
        id: "shield_bash",
        name: "盾击",
        effects: [{ kind: "deal_damage", amount: 6 }],
        intent: "attack",
      },
    ],
    // 出招由 combat.ts 的 shield_gremlin 专属分支处理（有友军则保护、否则攻击）。
    intentRule: { scripted: [], weighted: [] },
  },
  {
    id: "gremlin_wizard",
    name: "地精巫师",
    hpMin: 21,
    hpMax: 25,
    moves: [
      { id: "charging", name: "蓄力", effects: [], intent: "unknown" },
      {
        id: "ultimate_blast",
        name: "终极爆发",
        effects: [{ kind: "deal_damage", amount: 25 }],
        intent: "attack",
      },
    ],
    // 出招由 combat.ts 的 gremlin_wizard 专属分支处理（蓄力3回合→大招→循环）。
    intentRule: { scripted: [], weighted: [] },
  },

  {
    id: "looter",
    name: "拾荒者",
    hpMin: 44,
    hpMax: 48,
    moves: [
      {
        id: "mug",
        name: "抢劫",
        effects: [
          { kind: "deal_damage", amount: 10 },
          { kind: "steal_gold", amount: 15 },
        ],
        intent: "attack",
      },
      {
        id: "lunge",
        name: "猛扑",
        effects: [
          { kind: "deal_damage", amount: 12 },
          { kind: "steal_gold", amount: 15 },
        ],
        intent: "attack",
      },
      {
        id: "smoke_bomb",
        name: "烟雾弹",
        effects: [{ kind: "gain_block", amount: 6 }],
        intent: "defend",
      },
      {
        id: "flee",
        name: "逃跑",
        effects: [{ kind: "escape" }],
        intent: "unknown",
      },
    ],
    // 出招由 combat.ts 的 looter 专属分支处理（抢劫×2 → 猛扑/烟雾弹 → 逃跑）。
    intentRule: { scripted: [], weighted: [] },
  },
  {
    id: "red_slaver",
    name: "红色奴隶主",
    hpMin: 46,
    hpMax: 50,
    moves: [
      {
        id: "rs_stab",
        name: "刺击",
        effects: [{ kind: "deal_damage", amount: 13 }],
        intent: "attack",
      },
      {
        id: "scrape",
        name: "刮擦",
        effects: [
          { kind: "deal_damage", amount: 8 },
          { kind: "apply_power", power: "vulnerable", amount: 1, on: "target" },
        ],
        intent: "attack",
      },
      {
        id: "entangle",
        name: "缠绕",
        effects: [{ kind: "apply_power", power: "entangled", amount: 1, on: "target" }],
        intent: "debuff",
      },
    ],
    // 出招由 combat.ts 的 red_slaver 专属分支处理（首招刺击、缠绕一次性、刮擦/刺击）。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— 精英：地精头目（Enrage = 玩家出技能牌它加力量）——
  {
    id: "gremlin_nob",
    name: "地精头目",
    hpMin: 82,
    hpMax: 86,
    moves: [
      {
        id: "bellow",
        name: "咆哮",
        effects: [{ kind: "apply_power", power: "enrage", amount: 2, on: "self" }],
        intent: "buff",
      },
      {
        id: "rush",
        name: "猛冲",
        effects: [{ kind: "deal_damage", amount: 14 }],
        intent: "attack",
      },
      {
        id: "skull_bash",
        name: "碎颅击",
        effects: [
          { kind: "deal_damage", amount: 6 },
          { kind: "apply_power", power: "vulnerable", amount: 2, on: "target" },
        ],
        intent: "attack",
      },
    ],
    // asc0：首招必咆哮(上激怒2)；之后 roll<33 或连两次猛冲→碎颅击，否则猛冲（猛冲最多连2）。
    intentRule: {
      scripted: ["bellow"],
      weighted: [
        { move: "rush", weight: 67, maxInARow: 2 },
        { move: "skull_bash", weight: 33, maxInARow: 99 },
      ],
    },
  },

  // —— 精英：拉加维林（睡眠状态机 + 金属化 + 吸取灵魂减力量敏捷）——
  {
    id: "lagavulin",
    name: "拉加维林",
    hpMin: 109,
    hpMax: 111,
    moves: [
      {
        id: "sleep",
        name: "沉睡",
        effects: [],
        intent: "unknown",
      },
      {
        id: "lag_attack",
        name: "重击",
        effects: [{ kind: "deal_damage", amount: 18 }],
        intent: "attack",
      },
      {
        id: "siphon_soul",
        name: "吸取灵魂",
        effects: [
          { kind: "apply_power", power: "strength", amount: -1, on: "target" },
          { kind: "apply_power", power: "dexterity", amount: -1, on: "target" },
        ],
        intent: "debuff",
      },
    ],
    // 出招由 combat.ts 的 lagavulin 专属分支处理（睡眠/苏醒/攻击循环），intentRule 留空。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— 精英：哨卫（3 个一组，神器 + 错位光束/射钉）——
  {
    id: "sentry",
    name: "哨卫",
    hpMin: 38,
    hpMax: 42,
    moves: [
      {
        id: "beam",
        name: "光束",
        effects: [{ kind: "deal_damage", amount: 9 }],
        intent: "attack",
      },
      {
        id: "bolt",
        name: "射钉",
        effects: [{ kind: "add_card", cardId: "dazed", pile: "discard", count: 2 }],
        intent: "debuff",
      },
    ],
    // 出招由 combat.ts 的 sentry 专属分支处理（错位开局 + 严格交替），intentRule 留空。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— 切片 Boss：守卫者（模式切换 = 引擎能力验证点，issue #234 C10）——
  {
    id: "the_guardian",
    name: "守卫者",
    hpMin: 240,
    hpMax: 240,
    modeShiftThreshold: 30,
    stanceMoves: {
      offensive: ["charging_up", "fierce_bash", "vent_steam", "whirlwind"],
      // 防御姿态三招链：进入获得反甲 → 滚压 → 双重猛击（打完清反甲、回进攻的旋风）。
      defensive: ["defensive_mode", "roll_attack", "twin_slam"],
    },
    moves: [
      {
        id: "charging_up",
        name: "蓄能",
        effects: [{ kind: "gain_block", amount: 9 }],
        intent: "defend",
      },
      {
        id: "defensive_mode",
        name: "防御形态",
        // 获得反甲 3（被攻击反弹 3 点无视格挡伤害），持续到防御链结束。
        effects: [{ kind: "apply_power", power: "sharp_hide", amount: 3, on: "self" }],
        intent: "buff",
      },
      {
        id: "roll_attack",
        name: "滚压",
        effects: [{ kind: "deal_damage", amount: 9 }],
        intent: "attack",
      },
      {
        id: "fierce_bash",
        name: "重砸",
        effects: [{ kind: "deal_damage", amount: 32 }],
        intent: "attack",
      },
      {
        id: "vent_steam",
        name: "泄气",
        effects: [
          { kind: "apply_power", power: "weak", amount: 2, on: "target" },
          { kind: "apply_power", power: "vulnerable", amount: 2, on: "target" },
        ],
        intent: "debuff",
      },
      {
        id: "whirlwind",
        name: "旋风",
        effects: [{ kind: "deal_damage_multi", amount: 5, times: 4 }],
        intent: "attack",
      },
      {
        id: "twin_slam",
        name: "双重猛击",
        effects: [{ kind: "deal_damage_multi", amount: 8, times: 2 }],
        intent: "attack",
      },
    ],
    // Boss 出招走 stanceMoves 循环，不用 intentRule；留空满足类型。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— Boss：六火之灵（激活锁伤 → 分割6连 → 7 段仪轨循环）——
  {
    id: "hexaghost",
    name: "六火之灵",
    hpMin: 250,
    hpMax: 250,
    moves: [
      {
        id: "activate",
        name: "激活",
        effects: [{ kind: "store_hp_scaled_damage", divisor: 12, add: 1 }],
        intent: "buff",
      },
      {
        id: "divider",
        name: "分割",
        effects: [{ kind: "deal_damage_rolled", times: 6 }],
        intent: "attack",
      },
      {
        id: "sear",
        name: "灼烧",
        effects: [
          { kind: "deal_damage", amount: 6 },
          { kind: "add_card", cardId: "burn", pile: "discard", count: 1 },
        ],
        intent: "attack",
      },
      {
        id: "tackle",
        name: "冲撞",
        effects: [{ kind: "deal_damage_multi", amount: 5, times: 2 }],
        intent: "attack",
      },
      {
        id: "inflame",
        name: "燃焰",
        effects: [
          { kind: "gain_block", amount: 12 },
          { kind: "apply_power", power: "strength", amount: 2, on: "self" },
        ],
        intent: "buff",
      },
      {
        id: "inferno",
        name: "地狱火",
        effects: [{ kind: "deal_damage_multi", amount: 2, times: 6 }],
        intent: "attack",
      },
    ],
    // 出招由 combat.ts 的 hexaghost 专属分支处理，intentRule 留空。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— 大史莱姆（半血分裂成两只中史莱姆）——
  {
    id: "acid_slime_l",
    name: "酸液史莱姆（大）",
    hpMin: 65,
    hpMax: 69,
    splitInto: ["acid_slime_m", "acid_slime_m"],
    moves: [
      {
        id: "corrosive_spit_l",
        name: "腐蚀喷吐",
        effects: [
          { kind: "deal_damage", amount: 11 },
          { kind: "add_card", cardId: "slimed", pile: "discard", count: 2 },
        ],
        intent: "attack",
      },
      {
        id: "tackle_l",
        name: "冲撞",
        effects: [{ kind: "deal_damage", amount: 16 }],
        intent: "attack",
      },
      {
        id: "lick_l",
        name: "舔舐",
        effects: [{ kind: "apply_power", power: "weak", amount: 2, on: "target" }],
        intent: "debuff",
      },
    ],
    // 权重近似（对齐中酸液史莱姆的手感，L 精确权重待校准）。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "corrosive_spit_l", weight: 30, maxInARow: 2 },
        { move: "tackle_l", weight: 40, maxInARow: 1 },
        { move: "lick_l", weight: 30, maxInARow: 2 },
      ],
    },
  },
  {
    id: "spike_slime_l",
    name: "尖刺史莱姆（大）",
    hpMin: 64,
    hpMax: 70,
    splitInto: ["spike_slime_m", "spike_slime_m"],
    moves: [
      {
        id: "flame_tackle_l",
        name: "火焰冲撞",
        effects: [
          { kind: "deal_damage", amount: 16 },
          { kind: "add_card", cardId: "slimed", pile: "discard", count: 2 },
        ],
        intent: "attack",
      },
      {
        id: "lick_frail_l",
        name: "舔舐",
        effects: [{ kind: "apply_power", power: "frail", amount: 2, on: "target" }],
        intent: "debuff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "flame_tackle_l", weight: 70, maxInARow: 2 },
        { move: "lick_frail_l", weight: 30, maxInARow: 2 },
      ],
    },
  },

  // —— Boss：史莱姆王（3 回合循环 + 半血分裂成两只大史莱姆）——
  {
    id: "slime_boss",
    name: "史莱姆王",
    hpMin: 140,
    hpMax: 140,
    splitInto: ["spike_slime_l", "acid_slime_l"],
    moves: [
      {
        id: "goop_spray",
        name: "黏液喷射",
        effects: [{ kind: "add_card", cardId: "slimed", pile: "discard", count: 3 }],
        intent: "debuff",
      },
      {
        id: "preparing",
        name: "蓄力",
        effects: [],
        intent: "unknown",
      },
      {
        id: "slam",
        name: "猛砸",
        effects: [{ kind: "deal_damage", amount: 35 }],
        intent: "attack",
      },
    ],
    // 出招由 combat.ts 的 slime_boss 专属分支处理（黏液→蓄力→猛砸 循环），intentRule 留空。
    intentRule: { scripted: [], weighted: [] },
  },
];

const ENEMY_MAP: ReadonlyMap<string, EnemyDef> = new Map(
  ENEMY_LIST.map(enemy => [enemy.id, enemy]),
);

export function getEnemyDef(id: string): EnemyDef {
  const def = ENEMY_MAP.get(id);
  if (!def) {
    throw new Error(`未知敌人 id: ${id}`);
  }
  return def;
}

/** 敌人组：一个战斗节点里出现的一到多个敌人。 */
export type EncounterDef = { id: string; enemies: string[]; isBoss: boolean };

const ENCOUNTERS: Record<string, EncounterDef> = {
  cultist: { id: "cultist", enemies: ["cultist"], isBoss: false },
  jaw_worm: { id: "jaw_worm", enemies: ["jaw_worm"], isBoss: false },
  two_louse: { id: "two_louse", enemies: ["louse", "louse"], isBoss: false },
  // 小史莱姆组：50/50 两种组成（sts_lightspeed MonsterGroup）。
  small_slimes_a: {
    id: "small_slimes_a",
    enemies: ["spike_slime_s", "acid_slime_m"],
    isBoss: false,
  },
  small_slimes_b: {
    id: "small_slimes_b",
    enemies: ["acid_slime_s", "spike_slime_m"],
    isBoss: false,
  },
  three_louse: { id: "three_louse", enemies: ["louse", "louse", "louse"], isBoss: false },
  blue_slaver: { id: "blue_slaver", enemies: ["blue_slaver"], isBoss: false },
  lots_of_slimes: {
    id: "lots_of_slimes",
    enemies: ["spike_slime_s", "spike_slime_s", "spike_slime_s", "acid_slime_s", "acid_slime_s"],
    isBoss: false,
  },
  gremlin_nob: { id: "gremlin_nob", enemies: ["gremlin_nob"], isBoss: false },
  lagavulin: { id: "lagavulin", enemies: ["lagavulin"], isBoss: false },
  three_sentries: { id: "three_sentries", enemies: ["sentry", "sentry", "sentry"], isBoss: false },
  large_slime_acid: { id: "large_slime_acid", enemies: ["acid_slime_l"], isBoss: false },
  large_slime_spike: { id: "large_slime_spike", enemies: ["spike_slime_l"], isBoss: false },
  two_fungi_beasts: {
    id: "two_fungi_beasts",
    enemies: ["fungi_beast", "fungi_beast"],
    isBoss: false,
  },
  // 地精帮：固定代表性 4 只（含护盾/巫师/狂暴，展示各机制；StS 为随机组成）。
  gremlin_gang: {
    id: "gremlin_gang",
    enemies: ["mad_gremlin", "sneaky_gremlin", "shield_gremlin", "gremlin_wizard"],
    isBoss: false,
  },
  looter: { id: "looter", enemies: ["looter"], isBoss: false },
  red_slaver: { id: "red_slaver", enemies: ["red_slaver"], isBoss: false },
  guardian: { id: "guardian", enemies: ["the_guardian"], isBoss: true },
  hexaghost: { id: "hexaghost", enemies: ["hexaghost"], isBoss: true },
  slime_boss: { id: "slime_boss", enemies: ["slime_boss"], isBoss: true },
};

export function getEncounterDef(id: string): EncounterDef {
  const def = ENCOUNTERS[id];
  if (!def) {
    throw new Error(`未知敌人组 id: ${id}`);
  }
  return def;
}

// === Act1 普通战斗池（复刻 StS：前 WEAK_COMBAT_COUNT 场抽 weak 池，其余抽 strong 池）===
//
// 权重对齐 sts_lightspeed（MonsterEncounters.h，asc0）。
// weak 池四组各 25%。strong 池原表分母 16，此处只含**已实现怪物**的子集
// （blue_slaver 2 : three_louse 2 : lots_of_slimes 1，保留原相对权重）；
// gremlin_gang / red_slaver / looter / large_slime / fungi / exordium 待其怪物在后续里程碑加入。

type WeightedEncounter = { id: string; weight: number };

const WEAK_COMBAT_COUNT = 3;

const WEAK_ENCOUNTER_POOL: readonly WeightedEncounter[] = [
  { id: "cultist", weight: 1 },
  { id: "jaw_worm", weight: 1 },
  { id: "two_louse", weight: 1 },
  { id: "small_slimes", weight: 1 }, // 选中后再 50/50 展开为 _a / _b 两种组成
];

const STRONG_ENCOUNTER_POOL: readonly WeightedEncounter[] = [
  { id: "blue_slaver", weight: 2 },
  { id: "three_louse", weight: 2 },
  { id: "large_slime", weight: 2 }, // 选中后 50/50 展开为 酸液大 / 尖刺大
  { id: "two_fungi_beasts", weight: 2 },
  { id: "looter", weight: 2 },
  { id: "gremlin_gang", weight: 1 },
  { id: "red_slaver", weight: 1 },
  { id: "lots_of_slimes", weight: 1 },
];

function weightedPick(rng: RngState, pool: readonly WeightedEncounter[]): string {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = nextFloat(rng) * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.id;
    }
  }
  return pool[pool.length - 1]!.id;
}

/** 按已进入的普通战斗数选池 + 加权随机挑一个 encounter id。 */
export function pickNormalEncounter(rng: RngState, combatsEntered: number): string {
  const pool = combatsEntered < WEAK_COMBAT_COUNT ? WEAK_ENCOUNTER_POOL : STRONG_ENCOUNTER_POOL;
  const picked = weightedPick(rng, pool);
  if (picked === "small_slimes") {
    // 小史莱姆组的两种组成 50/50。
    return nextFloat(rng) < 0.5 ? "small_slimes_a" : "small_slimes_b";
  }
  if (picked === "large_slime") {
    // 大史莱姆 50/50 酸液 / 尖刺。
    return nextFloat(rng) < 0.5 ? "large_slime_acid" : "large_slime_spike";
  }
  return picked;
}

// Act1 精英池（等权重，不重复限制由 StS 的洗牌保证；此处简化为等权随机）。
// 拉加维林 / 哨卫在 M3b-2 加入。
const ELITE_ENCOUNTER_POOL: readonly WeightedEncounter[] = [
  { id: "gremlin_nob", weight: 1 },
  { id: "lagavulin", weight: 1 },
  { id: "three_sentries", weight: 1 },
];

/** 精英节点：从精英池挑一个 encounter id。 */
export function pickEliteEncounter(rng: RngState): string {
  return weightedPick(rng, ELITE_ENCOUNTER_POOL);
}

// Act1 Boss 池（等权重随机）。史莱姆王待分裂机制里程碑加入。
const BOSS_ENCOUNTER_POOL: readonly WeightedEncounter[] = [
  { id: "guardian", weight: 1 },
  { id: "hexaghost", weight: 1 },
  { id: "slime_boss", weight: 1 },
];

/** Boss 节点：随机挑一个 Boss encounter id。 */
export function pickBossEncounter(rng: RngState): string {
  return weightedPick(rng, BOSS_ENCOUNTER_POOL);
}
