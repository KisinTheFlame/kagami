import type { EnemyDef } from "../types.js";

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
        name: "啃咬",
        effects: [{ kind: "deal_damage", amount: 6 }],
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
        { move: "bite", weight: 75, maxInARow: 3 },
        { move: "grow", weight: 25, maxInARow: 1 },
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
        { move: "corrosive_spit", weight: 40, maxInARow: 2 },
        { move: "tackle", weight: 40, maxInARow: 2 },
        { move: "lick", weight: 20, maxInARow: 1 },
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
      defensive: ["twin_slam"],
    },
    moves: [
      {
        id: "charging_up",
        name: "蓄能",
        effects: [{ kind: "gain_block", amount: 9 }],
        intent: "defend",
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
  acid_slime: { id: "acid_slime", enemies: ["acid_slime_m"], isBoss: false },
  guardian: { id: "guardian", enemies: ["the_guardian"], isBoss: true },
};

export function getEncounterDef(id: string): EncounterDef {
  const def = ENCOUNTERS[id];
  if (!def) {
    throw new Error(`未知敌人组 id: ${id}`);
  }
  return def;
}

/** 切片普通战斗池（地图三个普通节点从这里选）。 */
export const NORMAL_ENCOUNTER_POOL: readonly string[] = [
  "cultist",
  "jaw_worm",
  "two_louse",
  "acid_slime",
];
