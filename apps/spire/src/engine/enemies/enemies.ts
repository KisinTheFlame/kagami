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

  // —— 第二幕（城市）普通敌人 ——
  {
    id: "snake_plant",
    name: "食蛇草",
    hpMin: 75,
    hpMax: 79,
    moves: [
      {
        id: "sp_chomp",
        name: "撕咬",
        effects: [{ kind: "deal_damage", amount: 7 }],
        intent: "attack",
      },
      {
        id: "sp_spores",
        name: "散播孢子",
        effects: [
          { kind: "apply_power", power: "weak", amount: 2, on: "target" },
          { kind: "apply_power", power: "frail", amount: 2, on: "target" },
        ],
        intent: "debuff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "sp_chomp", weight: 65, maxInARow: 2 },
        { move: "sp_spores", weight: 35, maxInARow: 1 },
      ],
    },
  },
  {
    id: "spheric_guardian",
    name: "球形守卫",
    hpMin: 20,
    hpMax: 20,
    moves: [
      {
        id: "sg_activate",
        name: "激活",
        effects: [{ kind: "gain_block", amount: 25 }],
        intent: "defend",
      },
      {
        id: "sg_slam",
        name: "猛击",
        effects: [{ kind: "deal_damage", amount: 10 }],
        intent: "attack",
      },
      {
        id: "sg_harden",
        name: "硬化",
        effects: [{ kind: "gain_block", amount: 15 }],
        intent: "defend",
      },
    ],
    // 首招激活(大格挡)，之后 猛击/硬化 交替；开局自带 3 层神器（见 createEnemyState）。
    intentRule: {
      scripted: ["sg_activate"],
      weighted: [
        { move: "sg_slam", weight: 50, maxInARow: 1 },
        { move: "sg_harden", weight: 50, maxInARow: 1 },
      ],
    },
  },
  {
    id: "centurion",
    name: "百夫长",
    hpMin: 76,
    hpMax: 80,
    moves: [
      {
        id: "cent_slash",
        name: "斩击",
        effects: [{ kind: "deal_damage", amount: 12 }],
        intent: "attack",
      },
      {
        id: "cent_fury",
        name: "狂怒连斩",
        effects: [{ kind: "deal_damage_multi", amount: 6, times: 3 }],
        intent: "attack",
      },
      {
        id: "cent_defend",
        name: "防守",
        effects: [{ kind: "gain_block", amount: 15 }],
        intent: "defend",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "cent_slash", weight: 50, maxInARow: 2 },
        { move: "cent_fury", weight: 25, maxInARow: 1 },
        { move: "cent_defend", weight: 25, maxInARow: 1 },
      ],
    },
  },

  {
    id: "shelled_parasite",
    name: "带壳寄生虫",
    hpMin: 68,
    hpMax: 72,
    moves: [
      {
        id: "double_strike",
        name: "双重打击",
        effects: [{ kind: "deal_damage_multi", amount: 6, times: 2 }],
        intent: "attack",
      },
      {
        id: "suck",
        name: "吸取",
        effects: [
          { kind: "deal_damage", amount: 10 },
          { kind: "heal_self", amount: 10 },
        ],
        intent: "attack",
      },
      {
        id: "fell",
        name: "重击",
        effects: [
          { kind: "deal_damage", amount: 18 },
          { kind: "apply_power", power: "frail", amount: 2, on: "target" },
        ],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "double_strike", weight: 45, maxInARow: 2 },
        { move: "fell", weight: 30, maxInARow: 1 },
        { move: "suck", weight: 25, maxInARow: 1 },
      ],
    },
  },
  {
    id: "chosen",
    name: "选民",
    hpMin: 95,
    hpMax: 99,
    moves: [
      {
        id: "poke",
        name: "戳刺",
        effects: [{ kind: "deal_damage", amount: 6 }],
        intent: "attack",
      },
      {
        id: "zap",
        name: "电击",
        effects: [{ kind: "deal_damage", amount: 18 }],
        intent: "attack",
      },
      {
        id: "drain",
        name: "汲取",
        effects: [
          { kind: "apply_power", power: "weak", amount: 3, on: "target" },
          { kind: "apply_power", power: "strength", amount: 3, on: "self" },
        ],
        intent: "buff",
      },
    ],
    // 首招汲取(削弱玩家+自强)，之后 戳刺/电击。
    intentRule: {
      scripted: ["drain"],
      weighted: [
        { move: "poke", weight: 55, maxInARow: 2 },
        { move: "zap", weight: 45, maxInARow: 1 },
      ],
    },
  },
  {
    id: "snecko",
    name: "史尼克",
    hpMin: 114,
    hpMax: 120,
    moves: [
      {
        id: "snecko_bite",
        name: "撕咬",
        effects: [{ kind: "deal_damage", amount: 15 }],
        intent: "attack",
      },
      {
        id: "tail_whip",
        name: "尾击",
        effects: [
          { kind: "deal_damage", amount: 8 },
          { kind: "apply_power", power: "weak", amount: 2, on: "target" },
        ],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "snecko_bite", weight: 60, maxInARow: 2 },
        { move: "tail_whip", weight: 40, maxInARow: 1 },
      ],
    },
  },
  {
    id: "mystic",
    name: "秘法师",
    hpMin: 48,
    hpMax: 56,
    moves: [
      {
        id: "mystic_heal",
        name: "治疗",
        effects: [{ kind: "heal_ally", amount: 16 }],
        intent: "buff",
      },
      {
        id: "mystic_buff",
        name: "鼓舞",
        effects: [{ kind: "apply_power", power: "strength", amount: 2, on: "all_enemies" }],
        intent: "buff",
      },
      {
        id: "mystic_attack",
        name: "法击",
        effects: [{ kind: "deal_damage", amount: 8 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "mystic_heal", weight: 35, maxInARow: 1 },
        { move: "mystic_buff", weight: 30, maxInARow: 1 },
        { move: "mystic_attack", weight: 35, maxInARow: 2 },
      ],
    },
  },

  // —— 第二幕精英 ——
  {
    id: "gremlin_leader",
    name: "地精首领",
    hpMin: 140,
    hpMax: 148,
    moves: [
      {
        id: "summon_gremlins",
        name: "召唤地精",
        effects: [{ kind: "summon", defIds: ["mad_gremlin", "sneaky_gremlin"] }],
        intent: "unknown",
      },
      {
        id: "encourage",
        name: "鼓舞",
        effects: [{ kind: "apply_power", power: "strength", amount: 3, on: "all_enemies" }],
        intent: "buff",
      },
      {
        id: "gl_stab",
        name: "突刺",
        effects: [{ kind: "deal_damage", amount: 6 }],
        intent: "attack",
      },
    ],
    // 召唤由 combat.ts gremlin_leader 分支处理（身边地精 <2 则召唤）；否则 鼓舞/突刺。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "encourage", weight: 40, maxInARow: 1 },
        { move: "gl_stab", weight: 60, maxInARow: 2 },
      ],
    },
  },
  {
    id: "taskmaster",
    name: "工头",
    hpMin: 54,
    hpMax: 60,
    moves: [
      {
        id: "scouring_whip",
        name: "抽打",
        effects: [
          { kind: "deal_damage", amount: 7 },
          { kind: "add_card", cardId: "wound", pile: "discard", count: 1 },
        ],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [{ move: "scouring_whip", weight: 1, maxInARow: 99 }],
    },
  },

  // —— 第二幕精英：穿刺之书（多段攻击）——
  {
    id: "book_of_stabbing",
    name: "穿刺之书",
    hpMin: 160,
    hpMax: 162,
    moves: [
      {
        id: "multi_stab",
        name: "乱刺",
        effects: [{ kind: "deal_damage_multi", amount: 6, times: 3 }],
        intent: "attack",
      },
      {
        id: "big_stab",
        name: "重刺",
        effects: [{ kind: "deal_damage", amount: 21 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "multi_stab", weight: 70, maxInARow: 99 },
        { move: "big_stab", weight: 30, maxInARow: 1 },
      ],
    },
  },

  // —— 第二幕 Boss：冠军（半血暴怒）——
  {
    id: "champ",
    name: "冠军",
    hpMin: 420,
    hpMax: 440,
    moves: [
      {
        id: "champ_slash",
        name: "重斩",
        effects: [{ kind: "deal_damage", amount: 16 }],
        intent: "attack",
      },
      {
        id: "face_slap",
        name: "扇脸",
        effects: [
          { kind: "deal_damage", amount: 12 },
          { kind: "apply_power", power: "weak", amount: 2, on: "target" },
          { kind: "apply_power", power: "frail", amount: 2, on: "target" },
        ],
        intent: "attack",
      },
      {
        id: "champ_defend",
        name: "防御姿态",
        effects: [
          { kind: "gain_block", amount: 15 },
          { kind: "apply_power", power: "metallicize", amount: 5, on: "self" },
        ],
        intent: "defend",
      },
      {
        id: "execute",
        name: "处决",
        effects: [{ kind: "deal_damage_multi", amount: 10, times: 2 }],
        intent: "attack",
      },
      {
        id: "gloat",
        name: "自夸",
        effects: [{ kind: "apply_power", power: "strength", amount: 3, on: "self" }],
        intent: "buff",
      },
      {
        id: "anger",
        name: "暴怒",
        effects: [{ kind: "apply_power", power: "strength", amount: 6, on: "self" }],
        intent: "buff",
      },
    ],
    // 半血暴怒（一次性）由 combat.ts champ 分支覆盖；其余走 weighted。
    intentRule: {
      scripted: [],
      weighted: [
        { move: "champ_slash", weight: 30, maxInARow: 2 },
        { move: "face_slap", weight: 20, maxInARow: 1 },
        { move: "champ_defend", weight: 20, maxInARow: 1 },
        { move: "execute", weight: 15, maxInARow: 1 },
        { move: "gloat", weight: 15, maxInARow: 1 },
      ],
    },
  },

  // —— 第二幕 Boss：青铜自动机（召唤青铜球 + 超射线）——
  {
    id: "bronze_automaton",
    name: "青铜自动机",
    hpMin: 300,
    hpMax: 300,
    moves: [
      {
        id: "spawn_orbs",
        name: "召唤青铜球",
        effects: [{ kind: "summon", defIds: ["bronze_orb", "bronze_orb"] }],
        intent: "unknown",
      },
      {
        id: "flail",
        name: "连枷",
        effects: [{ kind: "deal_damage_multi", amount: 7, times: 2 }],
        intent: "attack",
      },
      {
        id: "boost",
        name: "增益",
        effects: [
          { kind: "gain_block", amount: 9 },
          { kind: "apply_power", power: "strength", amount: 3, on: "self" },
        ],
        intent: "buff",
      },
      {
        id: "hyperbeam",
        name: "超射线",
        effects: [{ kind: "deal_damage", amount: 45 }],
        intent: "attack",
      },
    ],
    // 首招召唤两颗青铜球，之后 连枷/增益/超射线。
    intentRule: {
      scripted: ["spawn_orbs"],
      weighted: [
        { move: "flail", weight: 40, maxInARow: 2 },
        { move: "boost", weight: 35, maxInARow: 1 },
        { move: "hyperbeam", weight: 25, maxInARow: 1 },
      ],
    },
  },
  {
    id: "bronze_orb",
    name: "青铜球",
    hpMin: 52,
    hpMax: 52,
    moves: [
      {
        id: "orb_beam",
        name: "光束",
        effects: [{ kind: "deal_damage", amount: 8 }],
        intent: "attack",
      },
      {
        id: "orb_support",
        name: "支援",
        effects: [{ kind: "gain_block", amount: 6 }],
        intent: "defend",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "orb_beam", weight: 70, maxInARow: 2 },
        { move: "orb_support", weight: 30, maxInARow: 1 },
      ],
    },
  },

  // —— 第二幕 Boss：收藏家（召唤火把头 + 群体减益）——
  {
    id: "the_collector",
    name: "收藏家",
    hpMin: 282,
    hpMax: 300,
    moves: [
      {
        id: "spawn_torches",
        name: "召唤火把头",
        effects: [{ kind: "summon", defIds: ["torch_head", "torch_head"] }],
        intent: "unknown",
      },
      {
        id: "fireball",
        name: "火球",
        effects: [{ kind: "deal_damage", amount: 18 }],
        intent: "attack",
      },
      {
        id: "collector_buff",
        name: "增幅",
        effects: [
          { kind: "gain_block", amount: 15 },
          { kind: "apply_power", power: "strength", amount: 3, on: "self" },
        ],
        intent: "buff",
      },
      {
        id: "mega_debuff",
        name: "巨型削弱",
        effects: [
          { kind: "apply_power", power: "weak", amount: 3, on: "target" },
          { kind: "apply_power", power: "vulnerable", amount: 3, on: "target" },
          { kind: "apply_power", power: "frail", amount: 3, on: "target" },
        ],
        intent: "debuff",
      },
    ],
    // 首招召唤两个火把头，之后 火球/增幅/巨型削弱。
    intentRule: {
      scripted: ["spawn_torches"],
      weighted: [
        { move: "fireball", weight: 40, maxInARow: 2 },
        { move: "collector_buff", weight: 25, maxInARow: 1 },
        { move: "mega_debuff", weight: 35, maxInARow: 1 },
      ],
    },
  },
  {
    id: "torch_head",
    name: "火把头",
    hpMin: 38,
    hpMax: 40,
    moves: [
      {
        id: "torch_tackle",
        name: "冲撞",
        effects: [{ kind: "deal_damage", amount: 7 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [{ move: "torch_tackle", weight: 1, maxInARow: 99 }],
    },
  },

  // —— 第三幕（超越）普通敌人 ——
  {
    id: "exploder",
    name: "爆破怪",
    hpMin: 30,
    hpMax: 30,
    // 亡语：死亡时爆炸，对玩家造成 30 点伤害（杀它有代价）。
    deathEffects: [{ kind: "deal_damage", amount: 30 }],
    moves: [
      {
        id: "exp_slam",
        name: "撞击",
        effects: [{ kind: "deal_damage", amount: 9 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [{ move: "exp_slam", weight: 1, maxInARow: 99 }],
    },
  },
  {
    id: "spiker",
    name: "尖刺客",
    hpMin: 42,
    hpMax: 56,
    // 开局自带反甲 3（你每攻击它一次反弹 3；见 createEnemyState）。
    moves: [
      {
        id: "spk_cut",
        name: "切割",
        effects: [{ kind: "deal_damage", amount: 7 }],
        intent: "attack",
      },
      {
        id: "spk_spike",
        name: "增生尖刺",
        effects: [{ kind: "apply_power", power: "sharp_hide", amount: 2, on: "self" }],
        intent: "buff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "spk_cut", weight: 60, maxInARow: 2 },
        { move: "spk_spike", weight: 40, maxInARow: 1 },
      ],
    },
  },
  {
    id: "orb_walker",
    name: "球行者",
    hpMin: 90,
    hpMax: 96,
    moves: [
      {
        id: "ow_laser",
        name: "激光",
        effects: [
          { kind: "deal_damage", amount: 10 },
          { kind: "add_card", cardId: "burn", pile: "discard", count: 1 },
        ],
        intent: "attack",
      },
      {
        id: "ow_claw",
        name: "利爪",
        effects: [{ kind: "deal_damage", amount: 16 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "ow_laser", weight: 50, maxInARow: 2 },
        { move: "ow_claw", weight: 50, maxInARow: 1 },
      ],
    },
  },

  // —— 第三幕精英：蛇法师（召唤匕首）——
  {
    id: "reptomancer",
    name: "蛇法师",
    hpMin: 180,
    hpMax: 190,
    moves: [
      {
        id: "summon_daggers",
        name: "召唤匕首",
        effects: [{ kind: "summon", defIds: ["dagger", "dagger"] }],
        intent: "unknown",
      },
      {
        id: "snake_strike",
        name: "毒牙",
        effects: [
          { kind: "deal_damage", amount: 13 },
          { kind: "apply_power", power: "weak", amount: 1, on: "target" },
        ],
        intent: "attack",
      },
      {
        id: "big_bite",
        name: "巨口",
        effects: [{ kind: "deal_damage", amount: 30 }],
        intent: "attack",
      },
    ],
    // 首招召唤匕首，之后 毒牙/巨口（身边匕首少时再召唤由 reptomancer 分支处理）。
    intentRule: {
      scripted: ["summon_daggers"],
      weighted: [
        { move: "snake_strike", weight: 60, maxInARow: 2 },
        { move: "big_bite", weight: 40, maxInARow: 1 },
      ],
    },
  },
  {
    id: "dagger",
    name: "匕首",
    hpMin: 20,
    hpMax: 25,
    moves: [
      {
        id: "dagger_stab",
        name: "突刺",
        effects: [{ kind: "deal_damage", amount: 9 }],
        intent: "attack",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [{ move: "dagger_stab", weight: 1, maxInARow: 99 }],
    },
  },

  // —— 第三幕 Boss：铎努与迪卡（双子，互相增益）——
  {
    id: "deca",
    name: "迪卡",
    hpMin: 250,
    hpMax: 250,
    moves: [
      {
        id: "deca_beam",
        name: "光束",
        effects: [{ kind: "deal_damage_multi", amount: 10, times: 2 }],
        intent: "attack",
      },
      {
        id: "deca_protect",
        name: "守护",
        effects: [{ kind: "gain_block", amount: 16 }],
        intent: "defend",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "deca_beam", weight: 50, maxInARow: 1 },
        { move: "deca_protect", weight: 50, maxInARow: 1 },
      ],
    },
  },
  {
    id: "donu",
    name: "铎努",
    hpMin: 250,
    hpMax: 250,
    moves: [
      {
        id: "donu_beam",
        name: "光束",
        effects: [{ kind: "deal_damage_multi", amount: 10, times: 2 }],
        intent: "attack",
      },
      {
        id: "donu_power",
        name: "赋能",
        effects: [{ kind: "apply_power", power: "strength", amount: 3, on: "all_enemies" }],
        intent: "buff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "donu_beam", weight: 50, maxInARow: 1 },
        { move: "donu_power", weight: 50, maxInARow: 1 },
      ],
    },
  },

  {
    id: "repulsor",
    name: "斥力怪",
    hpMin: 29,
    hpMax: 35,
    moves: [
      {
        id: "rep_bash",
        name: "撞击",
        effects: [{ kind: "deal_damage", amount: 11 }],
        intent: "attack",
      },
      {
        id: "repulse",
        name: "斥力",
        effects: [{ kind: "add_card", cardId: "dazed", pile: "draw", count: 1 }],
        intent: "debuff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "rep_bash", weight: 60, maxInARow: 2 },
        { move: "repulse", weight: 40, maxInARow: 1 },
      ],
    },
  },
  {
    id: "transient",
    name: "无常",
    hpMin: 88,
    hpMax: 92,
    moves: [
      {
        id: "transient_slam",
        name: "重殴",
        effects: [{ kind: "deal_damage", amount: 30 }],
        intent: "attack",
      },
      {
        id: "fade",
        name: "消散",
        effects: [{ kind: "escape" }],
        intent: "unknown",
      },
    ],
    // 出招由 combat.ts transient 分支处理（重殴数回合后消散离场）。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— 第三幕精英：巨型头颅（蓄势后连续重击）——
  {
    id: "giant_head",
    name: "巨型头颅",
    hpMin: 500,
    hpMax: 500,
    moves: [
      {
        id: "gh_glare",
        name: "凝视",
        effects: [{ kind: "deal_damage", amount: 10 }],
        intent: "attack",
      },
      {
        id: "it_is_time",
        name: "时候到了",
        effects: [{ kind: "deal_damage", amount: 35 }],
        intent: "attack",
      },
    ],
    // 出招由 combat.ts giant_head 分支处理（前 3 回合凝视，之后每回合重击）。
    intentRule: { scripted: [], weighted: [] },
  },

  // —— 第三幕 Boss：觉醒者（死亡后复活二阶段）——
  {
    id: "awakened_one",
    name: "觉醒者",
    hpMin: 300,
    hpMax: 300,
    reviveHp: 300,
    moves: [
      {
        id: "aw_slash",
        name: "斩击",
        effects: [{ kind: "deal_damage", amount: 20 }],
        intent: "attack",
      },
      {
        id: "soul_strike",
        name: "灵魂打击",
        effects: [{ kind: "deal_damage_multi", amount: 6, times: 4 }],
        intent: "attack",
      },
      {
        id: "aw_buff",
        name: "汲取",
        effects: [{ kind: "apply_power", power: "strength", amount: 2, on: "self" }],
        intent: "buff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "aw_slash", weight: 45, maxInARow: 2 },
        { move: "soul_strike", weight: 35, maxInARow: 1 },
        { move: "aw_buff", weight: 20, maxInARow: 1 },
      ],
    },
  },

  // —— 第三幕 Boss：时间吞噬者（时间扭曲 + 半血加速）——
  {
    id: "time_eater",
    name: "时间吞噬者",
    hpMin: 456,
    hpMax: 456,
    timeWarpEvery: 12,
    moves: [
      {
        id: "te_reverberate",
        name: "混响",
        effects: [{ kind: "deal_damage_multi", amount: 7, times: 3 }],
        intent: "attack",
      },
      {
        id: "te_head_slam",
        name: "头槌",
        effects: [
          { kind: "deal_damage", amount: 26 },
          { kind: "apply_power", power: "draw_reduction", amount: 1, on: "target" },
        ],
        intent: "attack",
      },
      {
        id: "te_ripple",
        name: "涟漪",
        effects: [
          { kind: "gain_block", amount: 20 },
          { kind: "apply_power", power: "weak", amount: 1, on: "target" },
          { kind: "apply_power", power: "vulnerable", amount: 1, on: "target" },
        ],
        intent: "defend",
      },
      {
        id: "haste",
        name: "加速",
        effects: [{ kind: "boss_haste" }],
        intent: "buff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "te_reverberate", weight: 45, maxInARow: 2 },
        { move: "te_head_slam", weight: 35, maxInARow: 1 },
        { move: "te_ripple", weight: 20, maxInARow: 1 },
      ],
    },
  },

  // —— 第三幕精英：复仇魔（隔回合虚无缥缈无敌）——
  {
    id: "nemesis",
    name: "复仇魔",
    hpMin: 185,
    hpMax: 185,
    intangibleAfterMove: 2,
    moves: [
      {
        id: "nem_attack",
        name: "多重打击",
        effects: [{ kind: "deal_damage_multi", amount: 6, times: 3 }],
        intent: "attack",
      },
      {
        id: "nem_scythe",
        name: "巨镰",
        effects: [{ kind: "deal_damage", amount: 45 }],
        intent: "attack",
      },
      {
        id: "nem_debuff",
        name: "灼烧诅咒",
        effects: [{ kind: "add_card", cardId: "burn", pile: "discard", count: 3 }],
        intent: "debuff",
      },
    ],
    intentRule: {
      scripted: [],
      weighted: [
        { move: "nem_attack", weight: 35, maxInARow: 2 },
        { move: "nem_scythe", weight: 30, maxInARow: 1 },
        { move: "nem_debuff", weight: 35, maxInARow: 1 },
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
  // 第二幕
  snake_plant: { id: "snake_plant", enemies: ["snake_plant"], isBoss: false },
  spheric_guardian: { id: "spheric_guardian", enemies: ["spheric_guardian"], isBoss: false },
  centurion: { id: "centurion", enemies: ["centurion"], isBoss: false },
  two_centurions: { id: "two_centurions", enemies: ["centurion", "centurion"], isBoss: false },
  shelled_parasite: { id: "shelled_parasite", enemies: ["shelled_parasite"], isBoss: false },
  chosen: { id: "chosen", enemies: ["chosen"], isBoss: false },
  snecko: { id: "snecko", enemies: ["snecko"], isBoss: false },
  // 百夫长 + 秘法师：秘法师治疗/鼓舞百夫长，经典组合。
  centurion_mystic: { id: "centurion_mystic", enemies: ["centurion", "mystic"], isBoss: false },
  book_of_stabbing: { id: "book_of_stabbing", enemies: ["book_of_stabbing"], isBoss: false },
  // 地精首领带 2 只地精登场；死光了会继续召唤。
  gremlin_leader: {
    id: "gremlin_leader",
    enemies: ["mad_gremlin", "gremlin_leader", "sneaky_gremlin"],
    isBoss: false,
  },
  // 奴隶主小队：工头 + 蓝/红奴隶主。
  slavers: { id: "slavers", enemies: ["taskmaster", "blue_slaver", "red_slaver"], isBoss: false },
  champ: { id: "champ", enemies: ["champ"], isBoss: true },
  bronze_automaton: { id: "bronze_automaton", enemies: ["bronze_automaton"], isBoss: true },
  the_collector: { id: "the_collector", enemies: ["the_collector"], isBoss: true },
  // 第三幕
  exploder: { id: "exploder", enemies: ["exploder"], isBoss: false },
  spiker: { id: "spiker", enemies: ["spiker"], isBoss: false },
  orb_walker: { id: "orb_walker", enemies: ["orb_walker"], isBoss: false },
  two_exploders: { id: "two_exploders", enemies: ["exploder", "exploder"], isBoss: false },
  reptomancer: { id: "reptomancer", enemies: ["reptomancer"], isBoss: false },
  donu_deca: { id: "donu_deca", enemies: ["deca", "donu"], isBoss: true },
  repulsor: { id: "repulsor", enemies: ["repulsor"], isBoss: false },
  transient: { id: "transient", enemies: ["transient"], isBoss: false },
  two_orb_walkers: { id: "two_orb_walkers", enemies: ["orb_walker", "orb_walker"], isBoss: false },
  giant_head: { id: "giant_head", enemies: ["giant_head"], isBoss: false },
  awakened_one: { id: "awakened_one", enemies: ["awakened_one"], isBoss: true },
  time_eater: { id: "time_eater", enemies: ["time_eater"], isBoss: true },
  nemesis: { id: "nemesis", enemies: ["nemesis"], isBoss: false },
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

// —— 第二幕（城市）战斗池（切片：3 普通 + 1 精英 + 1 Boss；后续里程碑补齐 6 火之灵/自动机/收藏家等）——
const ACT2_WEAK_POOL: readonly WeightedEncounter[] = [
  { id: "spheric_guardian", weight: 1 },
  { id: "snake_plant", weight: 1 },
  { id: "centurion", weight: 1 },
  { id: "shelled_parasite", weight: 1 },
  { id: "chosen", weight: 1 },
];

const ACT2_STRONG_POOL: readonly WeightedEncounter[] = [
  { id: "chosen", weight: 2 },
  { id: "snecko", weight: 2 },
  { id: "centurion_mystic", weight: 2 },
  { id: "shelled_parasite", weight: 2 },
  { id: "snake_plant", weight: 1 },
  { id: "two_centurions", weight: 1 },
  { id: "spheric_guardian", weight: 1 },
];

// —— 第三幕（超越）战斗池（切片）——
const ACT3_WEAK_POOL: readonly WeightedEncounter[] = [
  { id: "spiker", weight: 1 },
  { id: "orb_walker", weight: 1 },
  { id: "exploder", weight: 1 },
  { id: "repulsor", weight: 1 },
];

const ACT3_STRONG_POOL: readonly WeightedEncounter[] = [
  { id: "orb_walker", weight: 2 },
  { id: "spiker", weight: 2 },
  { id: "transient", weight: 2 },
  { id: "repulsor", weight: 1 },
  { id: "two_exploders", weight: 1 },
  { id: "two_orb_walkers", weight: 1 },
];

function actWeakPool(act: number): readonly WeightedEncounter[] {
  if (act >= 3) return ACT3_WEAK_POOL;
  if (act >= 2) return ACT2_WEAK_POOL;
  return WEAK_ENCOUNTER_POOL;
}
function actStrongPool(act: number): readonly WeightedEncounter[] {
  if (act >= 3) return ACT3_STRONG_POOL;
  if (act >= 2) return ACT2_STRONG_POOL;
  return STRONG_ENCOUNTER_POOL;
}

/** 按已进入的普通战斗数选池 + 加权随机挑一个 encounter id（按幕选池）。 */
export function pickNormalEncounter(rng: RngState, combatsEntered: number, act = 1): string {
  const pool = combatsEntered < WEAK_COMBAT_COUNT ? actWeakPool(act) : actStrongPool(act);
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
const ELITE_ENCOUNTER_POOL: readonly WeightedEncounter[] = [
  { id: "gremlin_nob", weight: 1 },
  { id: "lagavulin", weight: 1 },
  { id: "three_sentries", weight: 1 },
];

// Act2 精英池：穿刺之书 / 地精首领 / 奴隶主小队。
const ACT2_ELITE_POOL: readonly WeightedEncounter[] = [
  { id: "book_of_stabbing", weight: 1 },
  { id: "gremlin_leader", weight: 1 },
  { id: "slavers", weight: 1 },
];

// Act3 精英池（切片：蛇法师；后续补 巨型头颅 / 复仇者）。
const ACT3_ELITE_POOL: readonly WeightedEncounter[] = [
  { id: "reptomancer", weight: 1 },
  { id: "giant_head", weight: 1 },
  { id: "nemesis", weight: 1 },
];

/** 精英节点：从精英池挑一个 encounter id（按幕选池）。 */
export function pickEliteEncounter(rng: RngState, act = 1): string {
  if (act >= 3) return weightedPick(rng, ACT3_ELITE_POOL);
  return weightedPick(rng, act >= 2 ? ACT2_ELITE_POOL : ELITE_ENCOUNTER_POOL);
}

// Act1 Boss 池（等权重随机）。
const BOSS_ENCOUNTER_POOL: readonly WeightedEncounter[] = [
  { id: "guardian", weight: 1 },
  { id: "hexaghost", weight: 1 },
  { id: "slime_boss", weight: 1 },
];

// Act2 Boss 池（切片：冠军；后续补 青铜自动机 / 收藏家）。
const ACT2_BOSS_POOL: readonly WeightedEncounter[] = [
  { id: "champ", weight: 1 },
  { id: "bronze_automaton", weight: 1 },
  { id: "the_collector", weight: 1 },
];

// Act3 Boss 池（切片：铎努与迪卡；后续补 觉醒者 / 时间吞噬者）。
const ACT3_BOSS_POOL: readonly WeightedEncounter[] = [
  { id: "donu_deca", weight: 1 },
  { id: "time_eater", weight: 1 },
  { id: "awakened_one", weight: 1 },
];

/** Boss 节点：随机挑一个 Boss encounter id（按幕选池）。 */
export function pickBossEncounter(rng: RngState, act = 1): string {
  if (act >= 3) return weightedPick(rng, ACT3_BOSS_POOL);
  return weightedPick(rng, act >= 2 ? ACT2_BOSS_POOL : BOSS_ENCOUNTER_POOL);
}
