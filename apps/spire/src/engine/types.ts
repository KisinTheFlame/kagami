// === 尖塔引擎的领域类型 ===
//
// 全部为纯数据（JSON 可往返），是存档、模拟器、HTTP 契约共享的形状。
// 复刻的是杀戮尖塔的**机制与数值**（功能性游戏规则），卡面文案为原创中文。
//
// 设计依据：本仓库根 AGENTS.md「KV 缓存优先」+ office-hours 设计文档 + issue #234。

export type CharacterId = "ironclad";

export type CardType = "attack" | "skill" | "power" | "status";

/** 状态效果标识。切片集合：被动修正器 + 时机触发机制（见 powers/）。 */
export type PowerId =
  | "strength" // 力量：攻击伤害 +N（被动）
  | "vulnerable" // 易伤：受到攻击伤害 ×1.5（回合末 -1）
  | "weak" // 虚弱：造成攻击伤害 ×0.75（回合末 -1）
  | "frail" // 脆弱：获得的格挡 ×0.75（回合末 -1）
  | "ritual" // 仪式：回合开始 +N 力量（触发）
  | "curl_up" // 蜷缩：首次被攻击时获得格挡（触发，一次性）
  | "sharp_hide" // 反甲：被攻击时对攻击者（玩家）反弹 N 点无视格挡的伤害（守卫者防御姿态）
  | "mode_shift"; // 模式切换累计（守卫者，内部计数用）

/** 玩家出牌 / 敌人出招共用的效果原语。target 相对「行动者」解析。 */
export type Effect =
  // strengthMultiplier：力量按该倍率计入伤害（重刃 ×3/×5）；省略即 ×1（普通攻击）。
  | { kind: "deal_damage"; amount: number; strengthMultiplier?: number }
  | { kind: "deal_damage_all"; amount: number }
  | { kind: "deal_damage_multi"; amount: number; times: number }
  // 每次命中随机挑一个存活敌人（剑刃回旋镖：3 点 ×3，逐次随机目标）。
  | { kind: "deal_damage_random"; amount: number; times: number }
  | { kind: "deal_damage_equal_to_block" }
  // 敌人用：伤害取自本敌人出生时掷定的固定值（红虱咬击：整场用同一个 5~7 基础值）。
  | { kind: "deal_damage_rolled" }
  | { kind: "gain_block"; amount: number }
  | { kind: "apply_power"; power: PowerId; amount: number; on: "self" | "target" | "all_enemies" }
  | { kind: "draw"; amount: number }
  | { kind: "gain_energy"; amount: number }
  | { kind: "lose_hp"; amount: number }
  | { kind: "add_card"; cardId: string; pile: "draw" | "discard" | "hand"; count: number };

/** 卡定义（静态数据表）。cost=null 表示不可打出（status/废牌）。 */
export type CardDef = {
  id: string;
  name: string;
  type: CardType;
  cost: number | null;
  /** 需要选择一个敌人目标（攻击类多为 true；AoE / 自身增益为 false）。 */
  targeted: boolean;
  /** 打出后进入消耗堆而非弃牌堆。 */
  exhausts: boolean;
  effects: Effect[];
  upgradedEffects: Effect[];
  description: string;
  upgradedDescription: string;
};

/** 牌组里的一张牌实例（追踪是否已升级）。 */
export type CardInstance = { uid: number; defId: string; upgraded: boolean };

export type PowerInstance = { id: PowerId; amount: number };

/** 敌人一次出招。intent 是给玩家看的意图分类；effects 是实际结算。 */
export type EnemyMove = {
  id: string;
  name: string;
  effects: Effect[];
  /** 给玩家渲染意图用的分类。attack 的展示数值在运行时按当前状态重算。 */
  intent: EnemyIntentKind;
};

export type EnemyIntentKind = "attack" | "defend" | "buff" | "debuff" | "unknown";

/** 敌人意图选择规则：脚本开局 + 加权随机 + 连续限制（复刻 StS 手感，issue #234 C8）。 */
export type IntentRule = {
  /** 按回合序号固定出招（1-based）；用尽后转 weighted。 */
  scripted: string[];
  weighted: { move: string; weight: number; maxInARow: number }[];
};

/** 敌人定义（静态数据表）。 */
export type EnemyDef = {
  id: string;
  name: string;
  hpMin: number;
  hpMax: number;
  moves: EnemyMove[];
  intentRule: IntentRule;
  /** 守卫者专用：模式切换阈值。省略表示无模式切换。 */
  modeShiftThreshold?: number;
  /** 守卫者专用：防御姿态下的出招表 id 与进攻姿态出招表 id。 */
  stanceMoves?: { offensive: string[]; defensive: string[] };
};

export type EnemyState = {
  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  powers: PowerInstance[];
  /** 最近若干次出招 id（判 maxInARow）。 */
  moveHistory: string[];
  /** 循环型出招（Boss 姿态轮转）的进度指针。 */
  rotationIndex: number;
  /** 本回合已 telegraph 的出招 id。 */
  currentMove: string;
  /** 蜷缩是否已消耗。 */
  curlUpConsumed: boolean;
  /** 出生时掷定、整场固定的攻击基础值（红虱咬击 5~7）。0 表示该敌人不用此机制。 */
  rolledDamage: number;
  /** 守卫者：进攻姿态下累计受到的伤害（达阈值切姿态后清零，非每回合重置——复刻 StS 累计语义）。 */
  modeShiftAccum: number;
  modeShiftThreshold: number | null;
  stance: "offensive" | "defensive" | null;
};

export type CombatState = {
  turn: number;
  energy: number;
  maxEnergy: number;
  playerBlock: number;
  playerPowers: PowerInstance[];
  enemies: EnemyState[];
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
  /** 本场战斗奖励的敌人组标识（用于 reward 生成）。 */
  encounterId: string;
  isBoss: boolean;
};

export type RewardState = {
  /** 三选一（或跳过）的卡奖励，存 defId + 是否升级。 */
  cardChoices: { defId: string; upgraded: boolean }[];
};

export type MapNodeType = "combat" | "elite" | "event" | "rest" | "shop" | "treasure" | "boss";

/** 分支地图节点（DAG）。next 是上一层可达节点 id；Boss 节点 next 为空。 */
export type MapNode = {
  id: string;
  row: number;
  col: number;
  type: MapNodeType;
  next: string[];
};

export type MapGraph = {
  nodes: Record<string, MapNode>;
  rows: number;
  /** 底层入口节点 id（首次选路从这里挑）。 */
  startNodeIds: string[];
  bossNodeId: string;
};

export type Screen = "map" | "combat" | "reward" | "rest" | "gameover" | "victory";

/** RNG 内部状态：必须完整可序列化并从存档精确复原（issue #234 C11）。 */
export type RngState = { s0: number; s1: number; s2: number; s3: number };

export type GameState = {
  /** 每个动作后自增，供 HTTP 幂等（expectedVersion）与乐观并发。 */
  version: number;
  runId: string;
  seed: number;
  character: CharacterId;
  ascension: number;
  screen: Screen;
  hp: number;
  maxHp: number;
  gold: number;
  /** 大牌组（master deck）。 */
  deck: CardInstance[];
  map: MapGraph;
  /** 当前所在地图节点 id；null = 还没进入地图（在底层选入口）。 */
  currentNodeId: string | null;
  combat: CombatState | null;
  reward: RewardState | null;
  /** 已进入过的普通战斗数（决定抽 weak / strong encounter 池，复刻 StS Act1 节奏）。 */
  combatsEntered: number;
  rng: RngState;
  /** 递增的牌实例 uid 分配器。 */
  nextUid: number;
  /** 仅「本次动作」产生的日志；GET /state 返回时清空（KV 字节确定性，issue #234 C3）。 */
  log: string[];
};
