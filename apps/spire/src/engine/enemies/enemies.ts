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
  guardian: { id: "guardian", enemies: ["the_guardian"], isBoss: true },
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
  return picked;
}

// Act1 精英池（等权重，不重复限制由 StS 的洗牌保证；此处简化为等权随机）。
// 拉加维林 / 哨卫在 M3b-2 加入。
const ELITE_ENCOUNTER_POOL: readonly WeightedEncounter[] = [{ id: "gremlin_nob", weight: 1 }];

/** 精英节点：从精英池挑一个 encounter id。 */
export function pickEliteEncounter(rng: RngState): string {
  return weightedPick(rng, ELITE_ENCOUNTER_POOL);
}
