import type {
  CardInstance,
  CardType,
  CombatState,
  Effect,
  EnemyState,
  GameState,
  Orb,
  OrbType,
  PlayerStance,
  PowerInstance,
  RelicState,
} from "../types.js";
import { getCardDef, costOf, effectsOf, rewardCardPoolOf, ALL_CARDS } from "../cards/cards.js";
import { getEnemyDef, getEncounterDef } from "../enemies/enemies.js";
import { nextRange, nextFloat, nextInt, shuffleInPlace } from "../rng.js";
import {
  addPower,
  computeAttackDamage,
  computeBlockGain,
  decayDebuffs,
  getPower,
  removePower,
} from "../powers/powers.js";
import { getRelicDef, hasRelic } from "../relics/relics.js";
import type { RelicDef } from "../relics/relics.js";
import { getPotionDef } from "../potions/potions.js";

// === 战斗状态机 ===
//
// 所有函数原地改 GameState（含 state.combat）。玩家血在 state.hp/maxHp，
// 玩家格挡/powers 在 combat.playerBlock/playerPowers。敌人各自持有 hp/block/powers。

const STARTING_ENERGY = 3;
const STARTING_HAND_SIZE = 5;
const MAX_HAND_SIZE = 10;
const MAX_ENEMIES = 5; // 场上敌人上限（地精首领召唤封顶）。
const DEFECT_ORB_SLOTS = 3; // 机器人默认球槽数。
// 充能球数值（+集中层数）：闪电被动/唤醒、冰霜被动/唤醒。
const LIGHTNING_PASSIVE = 3;
const LIGHTNING_EVOKE = 8;
const FROST_PASSIVE = 2;
const FROST_EVOKE = 5;
const DARK_PASSIVE = 6; // 暗球每回合结束累积的伤害（+集中）。
const PLASMA_PASSIVE_ENERGY = 1; // 等离子球每回合结束给 1 能量（不受集中影响）。
const PLASMA_EVOKE_ENERGY = 2; // 等离子球唤醒给 2 能量。
const OMEGA_DAMAGE = 50; // 奥米加每层每回合结束对全体的伤害（对齐 StS）。
const EXPUNGER_PER_CHARGE = 7; // 铸刃：湮灭之刃每点 X 充能对应的伤害。
// 磁力：每回合开始随机加入手牌的无色牌池（均为已实现的无色牌 id）。
const MAGNETISM_POOL = [
  "blind",
  "trip",
  "finesse",
  "good_instincts",
  "swift_strike",
  "flash_of_steel",
  "dramatic_entrance",
  "mind_blast",
  "madness",
  "dark_shackles",
];
// 白噪音：随机加入手牌的能力牌池（费用视为 0）。
const WHITE_NOISE_POOL = ["inflame", "feel_no_pain", "metallicize", "combust", "rupture"];
// 声东击西（分心）：随机加入手牌的技能牌池（费用视为 0）。
const DISTRACTION_POOL = [
  "blind",
  "trip",
  "finesse",
  "dark_shackles",
  "ghostly_armor",
  "bandage_up",
];
// 变形：随机洗入抽牌堆的攻击牌池（费用视为 0）。
const METAMORPH_POOL = [
  "swift_strike",
  "flash_of_steel",
  "mind_blast",
  "dramatic_entrance",
  "bite",
];
// 炼金：随机获得的药水池（均为已实现的药水 id）。
const ALCHEMIZE_POOL = [
  "block_potion",
  "strength_potion",
  "dexterity_potion",
  "energy_potion",
  "fire_potion",
  "weak_potion",
  "regen_potion",
];
// 你好世界：每回合开始随机加入手牌的「普通」牌池——从卡表动态取全部普通牌（含各色），自动随卡池增补同步。
const HELLO_WORLD_POOL: readonly string[] = ALL_CARDS.filter(c => c.rarity === "common").map(
  c => c.id,
);
const BOSS_GOLD_MIN = 95; // 击败首领掉金币区间（对齐 StS）。
const BOSS_GOLD_MAX = 105;
const AWAKENED_REVIVE_STRENGTH = 3; // 觉醒者复活时获得的力量。
const TIME_WARP_STRENGTH = 2; // 时间扭曲触发时时间吞噬者获得的力量。
const TRANSIENT_FADE_TURN = 5; // 无常连续攻击到第 5 回合消散离场。
const GIANT_HEAD_GLARE_TURNS = 3; // 巨型头颅前 3 回合凝视蓄势，之后连续重击。
const GUARDIAN_MODE_SHIFT_STEP = 10;
const GUARDIAN_SHIFT_BLOCK = 20;
const LOUSE_CURL_UP_MIN = 3;
const LOUSE_CURL_UP_MAX = 7;
const LOUSE_BITE_MIN = 5;
const LOUSE_BITE_MAX = 7;
const LAGAVULIN_METALLICIZE = 8;
const LAGAVULIN_WAKE_TURN = 3; // 睡满两回合、第 3 回合自然醒（combat.turn 从 1 起）。
const BURN_DAMAGE = 2;

// 六火之灵激活后的固定仪轨循环（Divider 之后重复）。
const HEXAGHOST_RITUAL = [
  "sear",
  "tackle",
  "sear",
  "inflame",
  "tackle",
  "sear",
  "inferno",
] as const;

type ActorRef = { side: "player" } | { side: "enemy"; index: number };

/** 仍在场的敌人：活着且未逃跑（逃跑的拾荒者退出战斗，不再算作战斗目标）。 */
function livingEnemies(combat: CombatState): EnemyState[] {
  return combat.enemies.filter(enemy => enemy.hp > 0 && !enemy.escaped);
}

function actorPowers(state: GameState, actor: ActorRef): PowerInstance[] {
  const combat = state.combat!;
  return actor.side === "player" ? combat.playerPowers : combat.enemies[actor.index]!.powers;
}

/** 敌人当前 telegraph 的出招是否为攻击意图（觅敌之弱 / 瞄准眼睛用）。 */
function enemyIntentIsAttack(enemy: EnemyState): boolean {
  const move = getEnemyDef(enemy.defId).moves.find(m => m.id === enemy.currentMove);
  return move?.intent === "attack";
}

// —— 开局 ——

/** 造一个敌人实例。hpOverride 用于分裂出的敌人（HP = 分裂瞬间当前值）。 */
function createEnemyState(state: GameState, defId: string, hpOverride?: number): EnemyState {
  const def = getEnemyDef(defId);
  const powers: PowerInstance[] = [];
  let rolledDamage = 0;
  let block = 0;
  let asleep = false;
  if (defId === "louse") {
    // 红虱开局自带蜷缩（首次被攻击获得格挡），block 值随机。
    const curl = nextRange(state.rng, LOUSE_CURL_UP_MIN, LOUSE_CURL_UP_MAX);
    powers.push({ id: "curl_up", amount: curl });
    // 咬击基础伤害出生时掷一次、整场固定（5~7）。
    rolledDamage = nextRange(state.rng, LOUSE_BITE_MIN, LOUSE_BITE_MAX);
  }
  if (defId === "lagavulin") {
    // 拉加维林开局沉睡：金属化 8（每回合结束回 8 格挡）+ 立即 8 格挡；受伤或睡满自然醒。
    asleep = true;
    block = LAGAVULIN_METALLICIZE;
    powers.push({ id: "metallicize", amount: LAGAVULIN_METALLICIZE });
  }
  if (defId === "sentry") {
    // 哨卫开局各带 1 层神器（抵消你首个减益）。
    powers.push({ id: "artifact", amount: 1 });
  }
  if (defId === "spheric_guardian") {
    // 球形守卫开局自带 3 层神器（抵消你前三个减益）。
    powers.push({ id: "artifact", amount: 3 });
  }
  if (defId === "shelled_parasite") {
    // 带壳寄生虫开局自带 14 层镀甲（每回合结束回格挡，被穿甲攻击时递减）。
    powers.push({ id: "plated_armor", amount: 14 });
  }
  if (defId === "spiker") {
    // 尖刺客开局自带 3 层反甲（你每攻击它一次反弹 3 点无视格挡伤害）。
    powers.push({ id: "sharp_hide", amount: 3 });
  }
  if (defId === "fungi_beast") {
    // 真菌兽开局自带孢子云（显示用；死亡给玩家 2 易伤由 deathEffects 结算）。
    powers.push({ id: "spore_cloud", amount: 2 });
  }
  if (defId === "mad_gremlin") {
    // 狂暴地精开局自带狂怒 1（每次受攻击伤害 +1 力量）。
    powers.push({ id: "angry", amount: 1 });
  }
  const hp = hpOverride ?? nextRange(state.rng, def.hpMin, def.hpMax);
  return {
    defId,
    name: def.name,
    hp,
    maxHp: hp,
    block,
    powers,
    moveHistory: [],
    rotationIndex: 0,
    currentMove: "",
    curlUpConsumed: false,
    rolledDamage,
    asleep,
    hasSplit: false,
    hasRevived: false,
    escaped: false,
    modeShiftAccum: 0,
    modeShiftThreshold: def.modeShiftThreshold ?? null,
    stance: def.stanceMoves ? "offensive" : null,
  } satisfies EnemyState;
}

export function startCombat(state: GameState, encounterId: string): void {
  const encounter = getEncounterDef(encounterId);
  const enemies: EnemyState[] = encounter.enemies.map(defId => createEnemyState(state, defId));

  const drawPile: CardInstance[] = state.deck.map(card => ({ ...card }));
  shuffleInPlace(state.rng, drawPile);

  const combat: CombatState = {
    turn: 1,
    energy: STARTING_ENERGY,
    maxEnergy: STARTING_ENERGY,
    playerBlock: 0,
    playerPowers: [],
    enemies,
    hand: [],
    drawPile,
    discardPile: [],
    exhaustPile: [],
    orbs: [],
    orbSlots: state.character === "defect" ? DEFECT_ORB_SLOTS : 0,
    playerStance: "none",
    mantra: 0,
    nextTurnBlock: 0,
    nextTurnEnergy: 0,
    nextTurnDraw: 0,
    nextTurnStance: null,
    nightmarePending: null,
    pendingBomb: null,
    extraTurnPending: false,
    doomedNextTurn: false,
    nextTurnPhantasmal: false,
    attacksThisTurn: 0,
    cardsDiscardedThisTurn: 0,
    cardsPlayedThisTurn: 0,
    mantraGainedThisCombat: 0,
    frostChanneledThisCombat: 0,
    lightningChanneledThisCombat: 0,
    powersPlayedThisCombat: 0,
    timesLostHpThisCombat: 0,
    clawDamageThisCombat: 0,
    retainHandThisTurn: false,
    lastCardType: null,
    encounterId,
    isBoss: encounter.isBoss,
    timeWarpEndTurnPending: false,
  };
  state.combat = combat;
  state.screen = "combat";

  // 每个敌人 telegraph 首个意图。
  for (let i = 0; i < combat.enemies.length; i += 1) {
    selectNextMove(state, i);
  }
  // 战斗开始遗物（船锚格挡 / 金刚杵力量 / 弹珠袋易伤 / 提灯能量 / 血瓶回血…）。
  triggerRelicCombatStart(state);
  // 残破核心（机器人起始遗物）：战斗开始充能 1 颗闪电球。
  if (hasRelic(state, "cracked_core")) {
    channelOrb(state, "lightning");
  }
  // 第 1 回合开始遗物（欢乐花能量 / 角锚 / 光滑石在 onCombatStart 已处理）。
  triggerRelicTurnStart(state);
  // 固有牌（背刺等）：开局必在起手，先从抽牌堆抽到手牌。
  const innate = drawPile.filter(card => {
    const cardDef = getCardDef(card.defId);
    return cardDef.innate || (card.upgraded && cardDef.upgradedInnate);
  });
  for (const card of innate) {
    const idx = combat.drawPile.indexOf(card);
    if (idx >= 0) {
      combat.drawPile.splice(idx, 1);
      combat.hand.push(card);
    }
  }
  // 蛇之戒指（静默起始遗物）：战斗第一回合额外抽 2 张。
  const firstTurnDraw = hasRelic(state, "ring_of_the_snake") ? 2 : 0;
  drawCards(state, Math.max(0, STARTING_HAND_SIZE + firstTurnDraw - innate.length));
  // 净水（观者起始遗物）：战斗开始时手牌加入 1 张奇迹。
  if (hasRelic(state, "pure_water")) {
    addCards(state, "miracle", "hand", 1);
  }
}

/** 遍历持有遗物，对每个的 hooks + 自身 RelicState 调用 fn（原地改 state）。 */
function fireRelics(
  state: GameState,
  fn: (hooks: RelicDef["hooks"], self: RelicState) => void,
): void {
  for (const relic of state.relics) {
    fn(getRelicDef(relic.id).hooks, relic);
  }
}

// 遗物可通过 emit 发射战斗 Effect（发伤 / AoE 遗物）；收集后以玩家为行动者统一结算。
function fireRelicsCollectingEmits(
  state: GameState,
  invoke: (hooks: RelicDef["hooks"], self: RelicState, emit: (effect: Effect) => void) => void,
): void {
  const emitted: Effect[] = [];
  const emit = (effect: Effect): void => {
    emitted.push(effect);
  };
  fireRelics(state, (hooks, self) => invoke(hooks, self, emit));
  if (emitted.length > 0) {
    applyEffects(state, emitted, { side: "player" }, null);
  }
}

function triggerRelicCombatStart(state: GameState): void {
  fireRelicsCollectingEmits(state, (hooks, self, emit) => hooks.onCombatStart?.(state, self, emit));
}
function triggerRelicCombatEnd(state: GameState): void {
  fireRelicsCollectingEmits(state, (hooks, self, emit) => hooks.onCombatEnd?.(state, self, emit));
}
function triggerRelicTurnStart(state: GameState): void {
  fireRelicsCollectingEmits(state, (hooks, self, emit) => hooks.onTurnStart?.(state, self, emit));
}
function triggerRelicTurnEnd(state: GameState): void {
  fireRelicsCollectingEmits(state, (hooks, self, emit) => hooks.onTurnEnd?.(state, self, emit));
}
function triggerRelicCardPlayed(state: GameState, cardType: CardType): void {
  fireRelicsCollectingEmits(state, (hooks, self, emit) =>
    hooks.onCardPlayed?.(state, self, cardType, emit),
  );
}

/** 消耗一张牌进消耗堆，并触发消耗型玩家能力（无痛加格挡 / 暗黑拥抱抽牌）。 */
function exhaustCard(state: GameState, instance: CardInstance): void {
  const combat = state.combat!;
  combat.exhaustPile.push(instance);
  // 哨戒：被消耗时结算该牌的 onExhaust（如回能量）。
  const exhaustDef = getCardDef(instance.defId);
  if (exhaustDef.onExhaust && exhaustDef.onExhaust.length > 0) {
    applyEffects(state, exhaustDef.onExhaust, { side: "player" }, null);
  }
  const feelNoPain = getPower(combat.playerPowers, "feel_no_pain");
  if (feelNoPain > 0) {
    combat.playerBlock += feelNoPain; // 直接加，不再触发主宰（避免连锁）。
  }
  const darkEmbrace = getPower(combat.playerPowers, "dark_embrace");
  if (darkEmbrace > 0) {
    drawCards(state, darkEmbrace);
  }
}

/** 打出一张牌后触发的玩家能力（千刃对全体发伤 / 残影加格挡）。 */
function triggerPlayerCardPlayed(state: GameState, cardType: CardType): void {
  const combat = state.combat!;
  const thousandCuts = getPower(combat.playerPowers, "thousand_cuts");
  if (thousandCuts > 0) {
    applyEffects(
      state,
      [{ kind: "deal_damage_all", amount: thousandCuts }],
      { side: "player" },
      null,
    );
  }
  const afterImage = getPower(combat.playerPowers, "after_image");
  if (afterImage > 0) {
    combat.playerBlock += afterImage; // 直接加，不触发主宰。
  }
  // 打出能力牌触发（机器人）：风暴充能闪电、散热抽牌。
  if (cardType === "power") {
    const storm = getPower(combat.playerPowers, "storm");
    for (let n = 0; n < storm; n += 1) {
      channelOrb(state, "lightning");
    }
    const heatsinks = getPower(combat.playerPowers, "heatsinks");
    if (heatsinks > 0) {
      drawCards(state, heatsinks);
    }
  }
  // 扼喉：本回合每打出一张牌，被扼喉的敌人直接损失 = 层数的生命（无视格挡）。
  for (const enemy of combat.enemies) {
    const choked = getPower(enemy.powers, "choked");
    if (enemy.hp > 0 && choked > 0) {
      enemy.hp = Math.max(0, enemy.hp - choked);
    }
  }
  // 剧痛（诅咒）：手牌里每有一张剧痛，你每打出一张牌就损失 1 点生命。
  const painCount = combat.hand.filter(card => card.defId === "pain").length;
  if (painCount > 0) {
    state.hp = Math.max(0, state.hp - painCount);
  }
  // 时间扭曲（时间吞噬者）：玩家每打出 timeWarpEvery 张牌，此敌人 +2 力量并立即结束玩家回合。
  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }
    const every = getEnemyDef(enemy.defId).timeWarpEvery;
    if (!every) {
      continue;
    }
    const next = getPower(enemy.powers, "time_warp") + 1;
    if (next >= every) {
      removePower(enemy.powers, "time_warp");
      addPower(enemy.powers, "strength", TIME_WARP_STRENGTH);
      combat.timeWarpEndTurnPending = true;
      state.log.push(`${enemy.name}扭曲了时间！`);
    } else {
      addPower(enemy.powers, "time_warp", 1);
    }
  }
}

// —— 抽牌 ——

function drawCards(state: GameState, count: number): void {
  const combat = state.combat!;
  // 战意：本回合无法再抽牌。
  if (getPower(combat.playerPowers, "no_draw") > 0) {
    return;
  }
  for (let drawn = 0; drawn < count; drawn += 1) {
    if (combat.drawPile.length === 0) {
      if (combat.discardPile.length === 0) {
        return; // 两堆皆空，抽不出。
      }
      combat.drawPile = combat.discardPile;
      combat.discardPile = [];
      shuffleInPlace(state.rng, combat.drawPile);
    }
    const card = combat.drawPile.pop()!;
    // 烈焰吐息：抽到状态牌或诅咒牌时，对所有敌人造成 = 层数的伤害。
    const fireBreathing = getPower(combat.playerPowers, "fire_breathing");
    if (fireBreathing > 0) {
      const drawnType = getCardDef(card.defId).type;
      if (drawnType === "status" || drawnType === "curse") {
        for (let i = 0; i < combat.enemies.length; i += 1) {
          if (combat.enemies[i]!.hp > 0) {
            dealDamageToEnemy(state, i, fireBreathing, []);
          }
        }
      }
    }
    if (combat.hand.length >= MAX_HAND_SIZE) {
      combat.discardPile.push(card); // 手牌满：抽到的牌直接进弃牌堆。
    } else {
      combat.hand.push(card);
      // 无尽痛楚：抽到时结算 onDraw（如把一张自身副本加入手牌）。
      const drawnDef = getCardDef(card.defId);
      if (drawnDef.onDraw && drawnDef.onDraw.length > 0) {
        applyEffects(state, drawnDef.onDraw, { side: "player" }, null);
      }
      // 机械降神：抽到即消耗自身（结算 onDraw 之后从手牌移除并进消耗堆）。
      if (drawnDef.exhaustOnDraw) {
        const at = combat.hand.indexOf(card);
        if (at >= 0) {
          combat.hand.splice(at, 1);
          exhaustCard(state, card);
        }
      }
    }
    // 进化：抽到状态牌 → 额外抽 = 层数的牌（递归有牌堆张数上限，不会无限）。
    const evolve = getPower(combat.playerPowers, "evolve");
    if (evolve > 0 && getCardDef(card.defId).type === "status") {
      drawCards(state, evolve);
    }
  }
}

/** 由牌效果把一张牌从手牌弃入弃牌堆：推进弃牌计数并触发该牌的 onDiscard（急智/应激反射）。 */
function discardFromHand(state: GameState, card: CardInstance): void {
  const combat = state.combat!;
  combat.discardPile.push(card);
  combat.cardsDiscardedThisTurn += 1;
  const def = getCardDef(card.defId);
  const onDiscard = card.upgraded && def.upgradedOnDiscard ? def.upgradedOnDiscard : def.onDiscard;
  if (onDiscard && onDiscard.length > 0) {
    applyEffects(state, onDiscard, { side: "player" }, null);
  }
}

// —— 效果解释器 ——

function applyEffects(
  state: GameState,
  effects: readonly Effect[],
  actor: ActorRef,
  targetEnemyIndex: number | null,
  xValue = 0,
  sourceCard?: CardInstance,
): void {
  for (const effect of effects) {
    applyEffect(state, effect, actor, targetEnemyIndex, xValue, sourceCard);
  }
}

function applyEffect(
  state: GameState,
  effect: Effect,
  actor: ActorRef,
  targetEnemyIndex: number | null,
  xValue = 0,
  sourceCard?: CardInstance,
): void {
  const combat = state.combat!;
  const powers = actorPowers(state, actor);

  switch (effect.kind) {
    case "deal_damage": {
      if (actor.side === "player") {
        if (targetEnemyIndex !== null) {
          // 活力：本次攻击额外 +层数伤害，随后清零（只加持一次攻击）。
          const vigor = getPower(combat.playerPowers, "vigor");
          // 敏锐：飞刀（shiv）额外 +层数伤害。
          const accuracyBonus =
            sourceCard?.defId === "shiv" ? getPower(combat.playerPowers, "accuracy") : 0;
          // 幻杀：本回合攻击造成双倍伤害。
          const phantasmalMult = getPower(combat.playerPowers, "phantasmal") > 0 ? 2 : 1;
          const unblocked = dealDamageToEnemy(
            state,
            targetEnemyIndex,
            (effect.amount + vigor + accuracyBonus) * phantasmalMult,
            powers,
            effect.strengthMultiplier,
          );
          onPlayerAttackHit(state, targetEnemyIndex, unblocked);
          if (vigor > 0) {
            removePower(combat.playerPowers, "vigor");
          }
        }
      } else {
        dealDamageToPlayer(state, effect.amount, powers, actor.index);
      }
      break;
    }
    case "deal_damage_random": {
      // 玩家专用：逐次挑一个存活敌人随机命中（剑刃回旋镖）。每击独立选目标。
      if (actor.side === "player") {
        for (let hit = 0; hit < effect.times; hit += 1) {
          const living = combat.enemies
            .map((enemy, index) => ({ enemy, index }))
            .filter(entry => entry.enemy.hp > 0);
          if (living.length === 0) {
            break;
          }
          const pick = living[nextInt(state.rng, living.length)]!.index;
          dealDamageToEnemy(state, pick, effect.amount, powers);
        }
      }
      break;
    }
    case "deal_damage_rolled": {
      // 敌人专用：用锁定的固定基础值攻击玩家（红虱咬击 ×1；六火之灵分割 ×times）。
      if (actor.side === "enemy") {
        const rolled = combat.enemies[actor.index]!.rolledDamage;
        const times = effect.times ?? 1;
        for (let hit = 0; hit < times; hit += 1) {
          dealDamageToPlayer(state, rolled, powers, actor.index);
        }
      }
      break;
    }
    case "store_hp_scaled_damage": {
      // 敌人专用：按玩家当前生命锁定每击伤害存入 rolledDamage（六火之灵激活）。
      if (actor.side === "enemy") {
        combat.enemies[actor.index]!.rolledDamage =
          Math.floor(state.hp / effect.divisor) + effect.add;
      }
      break;
    }
    case "deal_damage_multi": {
      for (let hit = 0; hit < effect.times; hit += 1) {
        if (actor.side === "player") {
          if (targetEnemyIndex !== null && combat.enemies[targetEnemyIndex]!.hp > 0) {
            const unblocked = dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
            onPlayerAttackHit(state, targetEnemyIndex, unblocked);
          }
        } else {
          dealDamageToPlayer(state, effect.amount, powers, actor.index);
        }
      }
      break;
    }
    case "deal_damage_all": {
      if (actor.side === "player") {
        for (let i = 0; i < combat.enemies.length; i += 1) {
          if (combat.enemies[i]!.hp > 0) {
            dealDamageToEnemy(state, i, effect.amount, powers);
          }
        }
      }
      break;
    }
    case "deal_damage_equal_to_block": {
      if (actor.side === "player" && targetEnemyIndex !== null) {
        dealDamageToEnemy(state, targetEnemyIndex, combat.playerBlock, powers);
      }
      break;
    }
    case "gain_block": {
      // 获得的格挡按「获得方」的敏捷/脆弱修正。
      const gained = computeBlockGain(effect.amount, powers);
      // 应急按钮：牌产生的格挡被抑制（本效果由牌结算，故直接跳过）。
      if (actor.side === "player" && getPower(combat.playerPowers, "no_card_block") > 0) {
        break;
      }
      if (actor.side === "player") {
        combat.playerBlock += gained;
        // 主宰：每当玩家获得格挡，对随机敌人造成 = 层数的伤害。
        const juggernaut = getPower(combat.playerPowers, "juggernaut");
        if (juggernaut > 0) {
          dealOrbDamage(state, juggernaut);
        }
        // 挥手：本回合每当获得格挡，令所有敌人获得 = 层数的虚弱。
        const wave = getPower(combat.playerPowers, "wave_of_the_hand");
        if (wave > 0) {
          for (const enemy of combat.enemies) {
            if (enemy.hp > 0) {
              applyPowerToEnemy(enemy, "weak", wave);
            }
          }
        }
      } else {
        combat.enemies[actor.index]!.block += gained;
      }
      break;
    }
    case "double_block": {
      // 玩家当前格挡翻倍（坚守）。
      if (actor.side === "player") {
        combat.playerBlock *= 2;
      }
      break;
    }
    case "channel_orb": {
      if (actor.side === "player") {
        channelOrb(state, effect.orbType);
      }
      break;
    }
    case "channel_orb_x": {
      // 雷暴倾泻：充能 X 颗指定球（消耗全部能量）。
      if (actor.side === "player") {
        for (let n = 0; n < xValue; n += 1) {
          channelOrb(state, effect.orbType);
        }
      }
      break;
    }
    case "channel_orb_per_enemy": {
      // 透骨寒：每个存活敌人充能 1 颗指定球。
      if (actor.side === "player") {
        const living = combat.enemies.filter(e => e.hp > 0).length;
        for (let n = 0; n < living; n += 1) {
          channelOrb(state, effect.orbType);
        }
      }
      break;
    }
    case "evoke": {
      if (actor.side === "player") {
        for (let n = 0; n < effect.count && combat.orbs.length > 0; n += 1) {
          evokeOrb(state, 0);
        }
      }
      break;
    }
    case "enter_stance": {
      if (actor.side === "player") {
        enterStance(state, effect.stance);
      }
      break;
    }
    case "gain_block_ally": {
      // 护盾地精：给一名随机存活友军（不含自己）加格挡。
      if (actor.side === "enemy") {
        const allies = combat.enemies
          .map((enemy, index) => ({ enemy, index }))
          .filter(entry => entry.enemy.hp > 0 && entry.index !== actor.index);
        if (allies.length > 0) {
          const pick = allies[nextInt(state.rng, allies.length)]!;
          pick.enemy.block += effect.amount;
        }
      }
      break;
    }
    case "apply_power": {
      applyPowerEffect(state, effect.power, effect.amount, effect.on, actor, targetEnemyIndex);
      // 虐念：玩家给敌人施加减益时，对受影响的敌人造成 = 层数的伤害。
      if (actor.side === "player" && effect.on !== "self" && DEBUFF_POWERS.has(effect.power)) {
        const sadistic = getPower(combat.playerPowers, "sadistic_nature");
        if (sadistic > 0) {
          if (effect.on === "target" && targetEnemyIndex !== null) {
            dealDamageToEnemy(state, targetEnemyIndex, sadistic, []);
          } else if (effect.on === "all_enemies") {
            for (let i = 0; i < combat.enemies.length; i += 1) {
              if (combat.enemies[i]!.hp > 0) {
                dealDamageToEnemy(state, i, sadistic, []);
              }
            }
          }
        }
      }
      break;
    }
    case "draw": {
      if (actor.side === "player") {
        drawCards(state, effect.amount);
      }
      break;
    }
    case "gain_energy": {
      if (actor.side === "player") {
        // amount 可为负（虚无抽到时 -1 能量）；能量不低于 0。
        combat.energy = Math.max(0, combat.energy + effect.amount);
      }
      break;
    }
    case "lose_hp": {
      if (actor.side === "player") {
        state.hp = Math.max(0, state.hp - effect.amount);
        // 破裂：因打出的牌失去生命 → 获得 = 层数的力量。
        const rupture = getPower(combat.playerPowers, "rupture");
        if (rupture > 0) {
          addPower(combat.playerPowers, "strength", rupture);
        }
      }
      break;
    }
    case "heal_percent": {
      if (actor.side === "player") {
        const heal = Math.floor((state.maxHp * effect.percent) / 100);
        state.hp = Math.min(state.maxHp, state.hp + heal);
      }
      break;
    }
    case "heal": {
      if (actor.side === "player") {
        state.hp = Math.min(state.maxHp, state.hp + effect.amount);
      }
      break;
    }
    case "gain_max_hp": {
      // 玩家永久 +最大生命并回复等量（果汁药水）。
      if (actor.side === "player") {
        state.maxHp += effect.amount;
        state.hp += effect.amount;
      }
      break;
    }
    case "double_strength": {
      // 玩家当前力量翻倍（极限爆发）；负力量同样翻倍。
      if (actor.side === "player") {
        const cur = getPower(combat.playerPowers, "strength");
        if (cur !== 0) {
          addPower(combat.playerPowers, "strength", cur);
        }
      }
      break;
    }
    case "steal_gold": {
      // 敌人偷金币（拾荒者）：最多偷 amount，玩家金币不足则偷光。
      if (actor.side === "enemy") {
        state.gold = Math.max(0, state.gold - Math.min(state.gold, effect.amount));
      }
      break;
    }
    case "escape": {
      // 敌人逃离战斗（拾荒者）：标记 escaped，不再算作战斗目标。
      if (actor.side === "enemy") {
        combat.enemies[actor.index]!.escaped = true;
        state.log.push(`${combat.enemies[actor.index]!.name}逃走了。`);
      }
      break;
    }
    case "heal_self": {
      // 敌人回复自身生命（带壳寄生虫吸取）。
      if (actor.side === "enemy") {
        const self = combat.enemies[actor.index]!;
        self.hp = Math.min(self.maxHp, self.hp + effect.amount);
      }
      break;
    }
    case "boss_haste": {
      // 加速（时间吞噬者）：把生命拉回到最大值的一半，并清除自身减益（虚弱/易伤/脆弱）。
      if (actor.side === "enemy") {
        const self = combat.enemies[actor.index]!;
        self.hp = Math.max(self.hp, Math.floor(self.maxHp / 2));
        removePower(self.powers, "weak");
        removePower(self.powers, "vulnerable");
        removePower(self.powers, "frail");
      }
      break;
    }
    case "heal_ally": {
      // 敌人治疗一名受伤的友军（秘法师）；无受伤友军则治自己。
      if (actor.side === "enemy") {
        const wounded = combat.enemies.filter(e => e.hp > 0 && !e.escaped && e.hp < e.maxHp);
        const targets = wounded.length > 0 ? wounded : [combat.enemies[actor.index]!];
        const pick = targets[nextInt(state.rng, targets.length)]!;
        pick.hp = Math.min(pick.maxHp, pick.hp + effect.amount);
      }
      break;
    }
    case "summon": {
      // 敌人召唤新敌人（地精首领）；场上敌人达上限则不再召唤，新生者本回合不行动。
      if (actor.side === "enemy") {
        for (const defId of effect.defIds) {
          if (livingEnemies(combat).length >= MAX_ENEMIES) {
            break;
          }
          const newIndex = combat.enemies.length;
          combat.enemies.push(createEnemyState(state, defId));
          selectNextMove(state, newIndex);
        }
      }
      break;
    }
    case "add_card": {
      addCards(state, effect.cardId, effect.pile, effect.count);
      break;
    }
    case "deal_damage_all_x": {
      // X 费：对所有敌人造成 amount 伤害，重复 X 次（旋风斩）。
      if (actor.side === "player") {
        for (let n = 0; n < xValue; n += 1) {
          for (let i = 0; i < combat.enemies.length; i += 1) {
            if (combat.enemies[i]!.hp > 0) {
              dealDamageToEnemy(state, i, effect.amount, powers);
            }
          }
        }
      }
      break;
    }
    case "deal_damage_x": {
      // X 费：对目标造成 amount 伤害，重复 X 次（穿刺）。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        for (let n = 0; n < xValue; n += 1) {
          if (combat.enemies[targetEnemyIndex]!.hp > 0) {
            dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
          }
        }
      }
      break;
    }
    case "gain_block_x": {
      // X 费：获得 amount 格挡，重复 X 次（强化机体）。
      if (actor.side === "player") {
        for (let n = 0; n < xValue; n += 1) {
          applyEffect(
            state,
            { kind: "gain_block", amount: effect.amount },
            actor,
            targetEnemyIndex,
          );
        }
      }
      break;
    }
    case "evoke_x": {
      // X 费：唤醒 X 颗球（多重施法）。
      if (actor.side === "player") {
        for (let n = 0; n < xValue && combat.orbs.length > 0; n += 1) {
          evokeOrb(state, 0);
        }
      }
      break;
    }
    case "apply_power_x": {
      // X 费：施加 amount×X 层（萎靡：-X 力量 / +X 虚弱）。
      applyPowerEffect(
        state,
        effect.power,
        effect.amount * xValue,
        effect.on,
        actor,
        targetEnemyIndex,
      );
      break;
    }
    case "deal_damage_draw_pile_count": {
      // 心灵冲击：对目标造成 = 抽牌堆张数的伤害。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        dealDamageToEnemy(state, targetEnemyIndex, combat.drawPile.length, powers);
      }
      break;
    }
    case "gain_block_per_hand_card": {
      // 灵盾：每张手牌获得 amount 格挡（本牌已离手，不计自身）。
      if (actor.side === "player") {
        const total = effect.amount * combat.hand.length;
        applyEffect(state, { kind: "gain_block", amount: total }, actor, targetEnemyIndex);
      }
      break;
    }
    case "deal_damage_per_hand_type": {
      // 飞镖：手牌中每张指定类型牌，对目标造成 amount 伤害（本牌已离手）。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const count = combat.hand.filter(
          card => getCardDef(card.defId).type === effect.cardType,
        ).length;
        for (let n = 0; n < count; n += 1) {
          if (combat.enemies[targetEnemyIndex]!.hp > 0) {
            dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
          }
        }
      }
      break;
    }
    case "deal_damage_perfected": {
      // 完美打击：基础 amount + per×(各牌堆 / 手牌中 id 含 "strike" 的牌数)。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const zones = [combat.hand, combat.drawPile, combat.discardPile, combat.exhaustPile];
        let strikes = 0;
        for (const zone of zones) {
          strikes += zone.filter(card => card.defId.includes("strike")).length;
        }
        dealDamageToEnemy(state, targetEnemyIndex, effect.amount + effect.per * strikes, powers);
      }
      break;
    }
    case "deal_damage_bane": {
      // 剧毒之刃：对目标造成 amount；若目标中毒则再造成 amount。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
        const target = combat.enemies[targetEnemyIndex]!;
        if (target.hp > 0 && getPower(target.powers, "poison") > 0) {
          dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
        }
      }
      break;
    }
    case "change_orb_slots": {
      // 吞噬 -1 / 电容器 +2：增减球槽数，下限 0。
      if (actor.side === "player") {
        combat.orbSlots = Math.max(0, combat.orbSlots + effect.delta);
        // 槽数减到比现有球少时，从最左唤醒溢出的球。
        while (combat.orbs.length > combat.orbSlots) {
          evokeOrb(state, 0);
        }
      }
      break;
    }
    case "gain_mantra": {
      // 观者：累积法力，达到 10 自动进入神性姿态。
      if (actor.side === "player") {
        gainMantra(state, effect.amount);
      }
      break;
    }
    case "scry": {
      if (actor.side === "player") {
        doScry(state, effect.amount);
      }
      break;
    }
    case "draw_to_full": {
      // 疾书：抽到手牌上限。
      if (actor.side === "player") {
        drawCards(state, Math.max(0, MAX_HAND_SIZE - combat.hand.length));
      }
      break;
    }
    case "exhaust_non_attacks": {
      // 断魂：消耗手牌中所有非攻击牌（走 exhaustCard，触发无痛/暗黑拥抱）。
      if (actor.side === "player") {
        const toExhaust = combat.hand.filter(c => getCardDef(c.defId).type !== "attack");
        combat.hand = combat.hand.filter(c => getCardDef(c.defId).type === "attack");
        for (const card of toExhaust) {
          exhaustCard(state, card);
        }
      }
      break;
    }
    case "exhaust_non_attacks_gain_block": {
      // 二度呼吸：消耗所有非攻击牌，每张 +amount 格挡。
      if (actor.side === "player") {
        const toExhaust = combat.hand.filter(c => getCardDef(c.defId).type !== "attack");
        combat.hand = combat.hand.filter(c => getCardDef(c.defId).type === "attack");
        for (const card of toExhaust) {
          exhaustCard(state, card);
          combat.playerBlock += effect.amount;
        }
      }
      break;
    }
    case "exhaust_hand_damage": {
      // 恶魔烈焰：消耗全部手牌，每张对目标造成 amount 伤害。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const cards = [...combat.hand];
        combat.hand = [];
        for (const card of cards) {
          exhaustCard(state, card);
        }
        for (let n = 0; n < cards.length; n += 1) {
          if (combat.enemies[targetEnemyIndex]!.hp > 0) {
            dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
          }
        }
      }
      break;
    }
    case "deal_damage_all_lifesteal": {
      // 收割：对所有敌人造成 amount，回复实际造成的总伤害。
      if (actor.side === "player") {
        let healed = 0;
        for (let i = 0; i < combat.enemies.length; i += 1) {
          const enemy = combat.enemies[i]!;
          if (enemy.hp > 0) {
            const before = enemy.hp;
            dealDamageToEnemy(state, i, effect.amount, powers);
            healed += before - enemy.hp;
          }
        }
        state.hp = Math.min(state.maxHp, state.hp + healed);
      }
      break;
    }
    case "multiply_target_poison": {
      // 催化剂：将目标当前中毒层数乘以 factor。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const target = combat.enemies[targetEnemyIndex]!;
        const poison = getPower(target.powers, "poison");
        if (poison > 0) {
          addPower(target.powers, "poison", poison * (effect.factor - 1));
        }
      }
      break;
    }
    case "deal_damage_per_orb": {
      // 弹幕：场上每颗充能球对目标造成 amount 伤害。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        for (let n = 0; n < combat.orbs.length; n += 1) {
          if (combat.enemies[targetEnemyIndex]!.hp > 0) {
            dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
          }
        }
      }
      break;
    }
    case "deal_damage_per_enemy": {
      // 保龄冲击：对目标造成 amount×(存活敌人数) 伤害（单次结算）。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const count = livingEnemies(combat).length;
        dealDamageToEnemy(state, targetEnemyIndex, effect.amount * count, powers);
      }
      break;
    }
    case "deal_damage_lesson": {
      // 研学有成：造成伤害；若因此击杀目标，永久升级牌组中一张随机未升级牌。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const wasAlive = combat.enemies[targetEnemyIndex]!.hp > 0;
        dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
        if (wasAlive && combat.enemies[targetEnemyIndex]!.hp <= 0) {
          const upgradable = state.deck.filter(card => !card.upgraded);
          if (upgradable.length > 0) {
            upgradable[nextInt(state.rng, upgradable.length)]!.upgraded = true;
          }
        }
      }
      break;
    }
    case "end_turn": {
      // 终局：实际的结束回合在 playCard 收尾处检测本效果后触发，这里不做事。
      break;
    }
    case "drain_marked_enemies": {
      // 点穴：所有敌人损失 = 各自标记层数的生命（无视格挡）。
      if (actor.side === "player") {
        for (const enemy of combat.enemies) {
          const marked = getPower(enemy.powers, "mark");
          if (enemy.hp > 0 && marked > 0) {
            enemy.hp = Math.max(0, enemy.hp - marked);
          }
        }
      }
      break;
    }
    case "play_top_card_exhaust": {
      // 浩劫：打出抽牌堆顶的一张牌（若需目标则随机选存活敌人），随后消耗它。
      if (actor.side === "player" && combat.drawPile.length > 0) {
        const top = combat.drawPile.pop()!;
        const topDef = getCardDef(top.defId);
        let topTarget: number | null = null;
        if (topDef.targeted) {
          const living = combat.enemies
            .map((enemy, index) => ({ enemy, index }))
            .filter(entry => entry.enemy.hp > 0);
          if (living.length > 0) {
            topTarget = living[nextInt(state.rng, living.length)]!.index;
          }
        }
        applyEffects(state, effectsOf(topDef, top.upgraded), { side: "player" }, topTarget, 0, top);
        exhaustCard(state, top);
      }
      break;
    }
    case "cap_hand_cost": {
      // 顿悟：本回合把当前手牌的费用压到不超过 cap（回合结束清除）。
      if (actor.side === "player") {
        for (const card of combat.hand) {
          card.costCapThisTurn = effect.cap;
        }
      }
      break;
    }
    case "add_random_card_free": {
      // 白噪音 / 分心 / 地狱之刃：将一张随机牌加入手牌，费用视为 0。
      if (actor.side === "player" && combat.hand.length < MAX_HAND_SIZE) {
        const pool =
          effect.pool === "power"
            ? WHITE_NOISE_POOL
            : effect.pool === "attack"
              ? METAMORPH_POOL
              : DISTRACTION_POOL;
        const id = pool[nextInt(state.rng, pool.length)]!;
        combat.hand.push({ uid: state.nextUid++, defId: id, upgraded: false, costZero: true });
      }
      break;
    }
    case "discard_hand_draw_same": {
      // 精算赌注：弃掉整手，然后抽等量的牌。
      if (actor.side === "player") {
        const count = combat.hand.length;
        const discarded = [...combat.hand];
        combat.hand = [];
        for (const card of discarded) {
          discardFromHand(state, card);
        }
        drawCards(state, count);
      }
      break;
    }
    case "bonus_if_target_weak": {
      // 勾拳：目标虚弱时，获得能量并抽牌。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        if (getPower(combat.enemies[targetEnemyIndex]!.powers, "weak") > 0) {
          combat.energy += effect.energy;
          drawCards(state, effect.draw);
        }
      }
      break;
    }
    case "put_hand_card_on_draw_bottom_free": {
      // 深谋：把一张手牌（自动取当前费用最高）置于抽牌堆底，本场费用视为 0。
      if (actor.side === "player" && combat.hand.length > 0) {
        let idx = 0;
        let high = -1;
        for (let i = 0; i < combat.hand.length; i += 1) {
          const c = costOf(getCardDef(combat.hand[i]!.defId), combat.hand[i]!.upgraded) ?? 0;
          if (c > high) {
            high = c;
            idx = i;
          }
        }
        const picked = combat.hand.splice(idx, 1)[0]!;
        picked.costZero = true;
        combat.drawPile.unshift(picked); // 底部 = 数组头（pop 从尾取）。
      }
      break;
    }
    case "draw_if_no_attacks": {
      // 急躁：手牌中没有攻击牌时抽牌。
      if (actor.side === "player") {
        const hasAttack = combat.hand.some(card => getCardDef(card.defId).type === "attack");
        if (!hasAttack) {
          drawCards(state, effect.amount);
        }
      }
      break;
    }
    case "exhaust_hand_up_to": {
      // 净化：消耗手牌中至多 count 张（自动取费用最低的）。
      if (actor.side === "player") {
        const sorted = [...combat.hand].sort(
          (a, b) =>
            (costOf(getCardDef(a.defId), a.upgraded) ?? 99) -
            (costOf(getCardDef(b.defId), b.upgraded) ?? 99),
        );
        const toExhaust = sorted.slice(0, effect.count);
        for (const card of toExhaust) {
          const at = combat.hand.indexOf(card);
          if (at >= 0) {
            combat.hand.splice(at, 1);
            exhaustCard(state, card);
          }
        }
      }
      break;
    }
    case "exhaust_one_draw": {
      // 焚誓：消耗一张手牌（自动取费用最低），然后抽 draw 张。
      if (actor.side === "player" && combat.hand.length > 0) {
        let idx = 0;
        let low = 99;
        for (let i = 0; i < combat.hand.length; i += 1) {
          const c = costOf(getCardDef(combat.hand[i]!.defId), combat.hand[i]!.upgraded) ?? 99;
          if (c < low) {
            low = c;
            idx = i;
          }
        }
        exhaustCard(state, combat.hand.splice(idx, 1)[0]!);
        drawCards(state, effect.draw);
      }
      break;
    }
    case "copy_hand_card": {
      // 双持：复制手牌中的一张攻击/能力牌（自动取费用最高）count 份加入手牌。
      if (actor.side === "player") {
        let idx = -1;
        let high = -1;
        for (let i = 0; i < combat.hand.length; i += 1) {
          const t = getCardDef(combat.hand[i]!.defId).type;
          if (t === "attack" || t === "power") {
            const c = costOf(getCardDef(combat.hand[i]!.defId), combat.hand[i]!.upgraded) ?? 0;
            if (c > high) {
              high = c;
              idx = i;
            }
          }
        }
        if (idx >= 0) {
          const src = combat.hand[idx]!;
          for (let n = 0; n < effect.count && combat.hand.length < MAX_HAND_SIZE; n += 1) {
            combat.hand.push({ uid: state.nextUid++, defId: src.defId, upgraded: src.upgraded });
          }
        }
      }
      break;
    }
    case "gain_energy_if_last_attack": {
      // 追击：若上一张打出的是攻击牌，获得能量。
      if (actor.side === "player" && combat.lastCardType === "attack") {
        combat.energy += effect.amount;
      }
      break;
    }
    case "return_from_discard": {
      // 冥想：从弃牌堆取回一张牌到手牌（自动取最近弃掉的一张）。
      if (
        actor.side === "player" &&
        combat.discardPile.length > 0 &&
        combat.hand.length < MAX_HAND_SIZE
      ) {
        combat.hand.push(combat.discardPile.pop()!);
      }
      break;
    }
    case "gain_random_potion": {
      // 炼金：把一瓶随机药水放入空药水槽（无空槽则作废）。
      if (actor.side === "player") {
        const slot = state.potions.indexOf(null);
        if (slot >= 0) {
          state.potions[slot] = ALCHEMIZE_POOL[nextInt(state.rng, ALCHEMIZE_POOL.length)]!;
        }
      }
      break;
    }
    case "transmutation": {
      // 嬗变：将 X 张随机无色牌加入手牌，费用视为 0。
      if (actor.side === "player") {
        for (let n = 0; n < xValue && combat.hand.length < MAX_HAND_SIZE; n += 1) {
          const id = MAGNETISM_POOL[nextInt(state.rng, MAGNETISM_POOL.length)]!;
          combat.hand.push({ uid: state.nextUid++, defId: id, upgraded: false, costZero: true });
        }
      }
      break;
    }
    case "upgrade_all_cards": {
      // 神化：本场剩余时间内升级你所有的牌（就地升级各堆里的牌实例）。
      if (actor.side === "player") {
        for (const pile of [combat.hand, combat.drawPile, combat.discardPile, combat.exhaustPile]) {
          for (const card of pile) {
            card.upgraded = true;
          }
        }
      }
      break;
    }
    case "upgrade_hand_cards": {
      // 军备：升级手牌——all 则全部，否则升级一张未升级的牌（自动取第一张）。
      if (actor.side === "player") {
        if (effect.all) {
          for (const card of combat.hand) {
            card.upgraded = true;
          }
        } else {
          const target = combat.hand.find(card => !card.upgraded);
          if (target) {
            target.upgraded = true;
          }
        }
      }
      break;
    }
    case "schedule_bomb": {
      // 炸弹：预约在若干回合后对所有敌人造成伤害。
      if (actor.side === "player") {
        combat.pendingBomb = { turns: effect.turns, damage: effect.damage };
      }
      break;
    }
    case "add_random_cards_to_draw": {
      // 蜕变 / 变形：将 count 张随机牌洗入抽牌堆的随机位置，费用视为 0。
      if (actor.side === "player") {
        const pool = effect.pool === "skill" ? DISTRACTION_POOL : METAMORPH_POOL;
        for (let n = 0; n < effect.count; n += 1) {
          const id = pool[nextInt(state.rng, pool.length)]!;
          const at = nextInt(state.rng, combat.drawPile.length + 1);
          combat.drawPile.splice(at, 0, {
            uid: state.nextUid++,
            defId: id,
            upgraded: false,
            costZero: true,
          });
        }
      }
      break;
    }
    case "fission": {
      // 裂变：唤醒所有充能球，每唤醒一颗获得 1 能量并抽 1 张。
      if (actor.side === "player") {
        const evoked = combat.orbs.length;
        for (let n = 0; n < evoked; n += 1) {
          evokeOrb(state, 0);
        }
        combat.energy += evoked;
        drawCards(state, evoked);
      }
      break;
    }
    case "return_from_exhaust": {
      // 掘尸：从消耗堆取回一张牌到手牌（自动取最近消耗的一张）。
      if (
        actor.side === "player" &&
        combat.exhaustPile.length > 0 &&
        combat.hand.length < MAX_HAND_SIZE
      ) {
        combat.hand.push(combat.exhaustPile.pop()!);
      }
      break;
    }
    case "conjure_blade": {
      // 铸刃：将一张「湮灭之刃」加入手牌，其伤害随 X（消耗的能量）提升。
      if (actor.side === "player" && combat.hand.length < MAX_HAND_SIZE) {
        combat.hand.push({
          uid: state.nextUid++,
          defId: "expunger",
          upgraded: false,
          bonus: xValue * EXPUNGER_PER_CHARGE,
        });
      }
      break;
    }
    case "lose_hp_per_hand_card": {
      // 悔恨：失去 = 手牌张数的生命（无视格挡）。
      if (actor.side === "player") {
        state.hp = Math.max(0, state.hp - combat.hand.length);
      }
      break;
    }
    case "play_top_card_twice": {
      // 全知：打出抽牌堆顶的牌两次（自动选目标），随后消耗。
      if (actor.side === "player" && combat.drawPile.length > 0) {
        const top = combat.drawPile.pop()!;
        const topDef = getCardDef(top.defId);
        let topTarget: number | null = null;
        if (topDef.targeted) {
          const living = combat.enemies
            .map((enemy, index) => ({ enemy, index }))
            .filter(entry => entry.enemy.hp > 0);
          if (living.length > 0) {
            topTarget = living[nextInt(state.rng, living.length)]!.index;
          }
        }
        for (let n = 0; n < 2; n += 1) {
          applyEffects(
            state,
            effectsOf(topDef, top.upgraded),
            { side: "player" },
            topTarget,
            0,
            top,
          );
        }
        exhaustCard(state, top);
      }
      break;
    }
    case "schedule_phantasmal": {
      // 幻杀：预约下个回合的攻击双倍。
      if (actor.side === "player") {
        combat.nextTurnPhantasmal = true;
      }
      break;
    }
    case "return_zero_cost_from_discard": {
      // 一心一意：把弃牌堆里所有 0 费牌收回手牌（含被疯狂/流水线变 0 的）。
      if (actor.side === "player") {
        const remaining: CardInstance[] = [];
        for (const card of combat.discardPile) {
          const zeroCost = card.costZero || costOf(getCardDef(card.defId), card.upgraded) === 0;
          if (zeroCost && combat.hand.length < MAX_HAND_SIZE) {
            combat.hand.push(card);
          } else {
            remaining.push(card);
          }
        }
        combat.discardPile = remaining;
      }
      break;
    }
    case "put_hand_card_on_draw_free": {
      // 布置：把一张手牌（自动取当前费用最高的一张）置于抽牌堆顶，本场费用视为 0。
      if (actor.side === "player" && combat.hand.length > 0) {
        let bestIdx = 0;
        let bestCost = -1;
        for (let i = 0; i < combat.hand.length; i += 1) {
          const c = costOf(getCardDef(combat.hand[i]!.defId), combat.hand[i]!.upgraded) ?? 0;
          if (c > bestCost) {
            bestCost = c;
            bestIdx = i;
          }
        }
        const picked = combat.hand.splice(bestIdx, 1)[0]!;
        picked.costZero = true;
        combat.drawPile.push(picked);
      }
      break;
    }
    case "scrape_draw": {
      // 削刮：抽 count 张，随后把其中费用 >0 的弃掉（仅留 0 费）。
      if (actor.side === "player") {
        const before = new Set(combat.hand.map(card => card.uid));
        drawCards(state, effect.count);
        const keep: CardInstance[] = [];
        for (const card of combat.hand) {
          const isNew = !before.has(card.uid);
          const zeroCost = card.costZero || costOf(getCardDef(card.defId), card.upgraded) === 0;
          if (isNew && !zeroCost) {
            combat.discardPile.push(card);
          } else {
            keep.push(card);
          }
        }
        combat.hand = keep;
      }
      break;
    }
    case "schedule_card_copies": {
      // 噩梦：把一张手牌（自动取当前费用最高）预约到下回合加 count 张副本。
      if (actor.side === "player" && combat.hand.length > 0) {
        let bestIdx = 0;
        let bestCost = -1;
        for (let i = 0; i < combat.hand.length; i += 1) {
          const c = costOf(getCardDef(combat.hand[i]!.defId), combat.hand[i]!.upgraded) ?? 0;
          if (c > bestCost) {
            bestCost = c;
            bestIdx = i;
          }
        }
        combat.nightmarePending = { cardId: combat.hand[bestIdx]!.defId, count: effect.count };
      }
      break;
    }
    case "schedule_extra_turn": {
      // 宝库：预约一个额外回合（结束回合后跳过敌人行动）。
      if (actor.side === "player") {
        combat.extraTurnPending = true;
      }
      break;
    }
    case "collect_charge": {
      // 采集：接下来 X 个回合各得一张 0 费「洞悉」（记为 collect 层数，回合始消耗一层）。
      if (actor.side === "player") {
        addPower(combat.playerPowers, "collect", xValue);
      }
      break;
    }
    case "bonus_if_target_vulnerable": {
      // 飞踢：目标处于易伤时，获得能量并抽牌。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        if (getPower(combat.enemies[targetEnemyIndex]!.powers, "vulnerable") > 0) {
          combat.energy += effect.energy;
          drawCards(state, effect.draw);
        }
      }
      break;
    }
    case "weaken_enemy_strength": {
      // 黑暗枷锁：目标临时失去力量，记入枷锁，待其行动过后归还。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const enemy = combat.enemies[targetEnemyIndex]!;
        if (enemy.hp > 0) {
          addPower(enemy.powers, "strength", -effect.amount);
          addPower(enemy.powers, "shackled", effect.amount);
        }
      }
      break;
    }
    case "weaken_all_enemies_strength": {
      // 穿刺尖啸：所有敌人临时失去力量，各自行动过后归还。
      if (actor.side === "player") {
        for (const enemy of combat.enemies) {
          if (enemy.hp > 0) {
            addPower(enemy.powers, "strength", -effect.amount);
            addPower(enemy.powers, "shackled", effect.amount);
          }
        }
      }
      break;
    }
    case "deal_damage_plus_mantra_gained": {
      // 璀璨光辉：对目标造成 base + 本场累计法力。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        dealDamageToEnemy(
          state,
          targetEnemyIndex,
          effect.base + combat.mantraGainedThisCombat,
          powers,
        );
      }
      break;
    }
    case "deal_damage_all_per_frost_channeled": {
      // 暴风雪：对所有敌人造成 per×本场充能冰霜数。
      if (actor.side === "player") {
        const dmg = effect.per * combat.frostChanneledThisCombat;
        for (let i = 0; i < combat.enemies.length; i += 1) {
          if (combat.enemies[i]!.hp > 0) {
            dealDamageToEnemy(state, i, dmg, powers);
          }
        }
      }
      break;
    }
    case "deal_damage_random_per_lightning_channeled": {
      // 雷霆一击：对随机存活敌人造成 amount，重复 = 本场充能闪电数。
      if (actor.side === "player") {
        for (let n = 0; n < combat.lightningChanneledThisCombat; n += 1) {
          const living = combat.enemies
            .map((enemy, index) => ({ enemy, index }))
            .filter(entry => entry.enemy.hp > 0);
          if (living.length === 0) {
            break;
          }
          dealDamageToEnemy(
            state,
            living[nextInt(state.rng, living.length)]!.index,
            effect.amount,
            powers,
          );
        }
      }
      break;
    }
    case "gain_block_next_turn": {
      if (actor.side === "player") {
        combat.nextTurnBlock += effect.amount;
      }
      break;
    }
    case "gain_energy_next_turn": {
      if (actor.side === "player") {
        combat.nextTurnEnergy += effect.amount;
      }
      break;
    }
    case "draw_next_turn": {
      if (actor.side === "player") {
        combat.nextTurnDraw += effect.amount;
      }
      break;
    }
    case "schedule_next_turn_x": {
      // 镜影分身：下个回合开始多抽 X 张、多得 X 能量。
      if (actor.side === "player") {
        combat.nextTurnDraw += xValue;
        combat.nextTurnEnergy += xValue;
      }
      break;
    }
    case "schedule_stance_next_turn": {
      // 烈怒渐起：下个回合开始进入指定姿态并多抽牌。
      if (actor.side === "player") {
        combat.nextTurnStance = effect.stance;
        combat.nextTurnDraw += effect.draw;
      }
      break;
    }
    case "set_doomed": {
      // 亵渎：下个回合开始时角色死亡。
      if (actor.side === "player") {
        combat.doomedNextTurn = true;
      }
      break;
    }
    case "gain_energy_if_discarded": {
      // 声东击西：若本回合弃过牌，获得能量。
      if (actor.side === "player" && combat.cardsDiscardedThisTurn > 0) {
        combat.energy += effect.amount;
      }
      break;
    }
    case "draw_if_cards_played_le": {
      // 超光速：若本回合出牌数（含本张）不超过 max，抽 amount 张。
      if (actor.side === "player" && combat.cardsPlayedThisTurn <= effect.max) {
        drawCards(state, effect.amount);
      }
      break;
    }
    case "draw_then_block_if_skill": {
      // 脱身之策：抽 1 张，若抽到的是技能则获得格挡。
      if (actor.side === "player") {
        const before = combat.hand.length;
        drawCards(state, 1);
        const drawn = combat.hand.length > before ? combat.hand[combat.hand.length - 1] : undefined;
        if (drawn && getCardDef(drawn.defId).type === "skill") {
          applyEffect(
            state,
            { kind: "gain_block", amount: effect.amount },
            actor,
            targetEnemyIndex,
          );
        }
      }
      break;
    }
    case "discard_random": {
      // 随机弃牌（优先弃状态牌）：把选中的牌从手牌移入弃牌堆。
      if (actor.side === "player") {
        for (let n = 0; n < effect.count && combat.hand.length > 0; n += 1) {
          let idx = combat.hand.findIndex(c => getCardDef(c.defId).type === "status");
          if (idx < 0) {
            idx = nextInt(state.rng, combat.hand.length);
          }
          discardFromHand(state, combat.hand.splice(idx, 1)[0]!);
        }
      }
      break;
    }
    case "discard_non_attacks": {
      // 卸货：弃掉手牌中所有非攻击牌。
      if (actor.side === "player") {
        const keep: CardInstance[] = [];
        for (const card of combat.hand) {
          if (getCardDef(card.defId).type === "attack") {
            keep.push(card);
          } else {
            discardFromHand(state, card);
          }
        }
        combat.hand = keep;
      }
      break;
    }
    case "apply_poison_random": {
      // 弹跳药瓶：对随机存活敌人施加 amount 中毒，重复 times 次。
      if (actor.side === "player") {
        for (let n = 0; n < effect.times; n += 1) {
          const living = combat.enemies
            .map((enemy, index) => ({ enemy, index }))
            .filter(entry => entry.enemy.hp > 0);
          if (living.length === 0) {
            break;
          }
          const pick = living[nextInt(state.rng, living.length)]!;
          applyPowerToEnemy(pick.enemy, "poison", effect.amount);
        }
      }
      break;
    }
    case "draw_up_to": {
      // 专精：抽牌直到手牌达到 target 张。
      if (actor.side === "player") {
        drawCards(state, Math.max(0, effect.target - combat.hand.length));
      }
      break;
    }
    case "deal_damage_per_attack": {
      // 终结技：对目标造成 amount×(本回合此前打出的攻击牌数)。
      if (actor.side === "player" && targetEnemyIndex !== null && combat.attacksThisTurn > 0) {
        dealDamageToEnemy(state, targetEnemyIndex, effect.amount * combat.attacksThisTurn, powers);
      }
      break;
    }
    case "gain_block_if_none": {
      // 自动护盾：仅当前无格挡时获得格挡。
      if (actor.side === "player" && combat.playerBlock === 0) {
        applyEffect(state, { kind: "gain_block", amount: effect.amount }, actor, targetEnemyIndex);
      }
      break;
    }
    case "channel_random_orb": {
      // 混沌：随机充能 count 颗球。
      if (actor.side === "player") {
        const types: OrbType[] = ["lightning", "frost", "dark", "plasma"];
        for (let n = 0; n < effect.count; n += 1) {
          channelOrb(state, types[nextInt(state.rng, types.length)]!);
        }
      }
      break;
    }
    case "gain_block_discard_count": {
      // 堆叠：每张弃牌堆的牌获得 perCard 格挡。
      if (actor.side === "player") {
        const total = effect.perCard * combat.discardPile.length;
        applyEffect(state, { kind: "gain_block", amount: total }, actor, targetEnemyIndex);
      }
      break;
    }
    case "gain_energy_per_draw_pile": {
      // 聚合：抽牌堆每 divisor 张给 1 能量。
      if (actor.side === "player" && effect.divisor > 0) {
        combat.energy += Math.floor(combat.drawPile.length / effect.divisor);
      }
      break;
    }
    case "remove_target_block": {
      // 熔化：移除目标全部格挡。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        combat.enemies[targetEnemyIndex]!.block = 0;
      }
      break;
    }
    case "change_max_energy": {
      // 苦修：增减每回合最大能量（同时调整本回合当前能量）。
      if (actor.side === "player") {
        combat.maxEnergy = Math.max(0, combat.maxEnergy + effect.delta);
        combat.energy = Math.max(0, combat.energy + effect.delta);
      }
      break;
    }
    case "gain_block_if_wrath": {
      // 止：获得 base 格挡；若处于愤怒姿态再 +bonus。
      if (actor.side === "player") {
        const total = effect.base + (combat.playerStance === "wrath" ? effect.bonus : 0);
        applyEffect(state, { kind: "gain_block", amount: total }, actor, targetEnemyIndex);
      }
      break;
    }
    case "execute_if_below": {
      // 审判：目标当前生命 ≤ threshold 则直接击杀。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const target = combat.enemies[targetEnemyIndex]!;
        if (target.hp > 0 && target.hp <= effect.threshold) {
          dealDamageToEnemy(state, targetEnemyIndex, target.hp, powers);
        }
      }
      break;
    }
    case "apply_strength_temp": {
      // 屈伸：立即 +amount 力量，并记录本回合结束时要减掉的量。
      if (actor.side === "player") {
        addPower(combat.playerPowers, "strength", effect.amount);
        addPower(combat.playerPowers, "strength_temp", effect.amount);
      }
      break;
    }
    case "deal_damage_scaling": {
      // 暴走/玻璃刀：对目标造成 base + 本牌 bonus 的伤害。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const dmg = Math.max(0, effect.base + (sourceCard?.bonus ?? 0));
        dealDamageToEnemy(state, targetEnemyIndex, dmg, powers);
      }
      break;
    }
    case "gain_block_scaling": {
      // 坚韧：获得 base + 本牌 bonus 的格挡。
      if (actor.side === "player") {
        const amount = Math.max(0, effect.base + (sourceCard?.bonus ?? 0));
        applyEffect(state, { kind: "gain_block", amount }, actor, targetEnemyIndex);
      }
      break;
    }
    case "grow_self": {
      // 本牌 bonus += amount（本场战斗内持续；下场战斗从牌组复制重置）。
      if (sourceCard) {
        sourceCard.bonus = (sourceCard.bonus ?? 0) + effect.amount;
      }
      break;
    }
    case "deal_damage_claw": {
      // 爪击：造成 base + 本场爪击加成，随后本场爪击加成 +2（作用于后续所有爪击）。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const dmg = Math.max(0, effect.base + combat.clawDamageThisCombat);
        dealDamageToEnemy(state, targetEnemyIndex, dmg, powers);
        combat.clawDamageThisCombat += 2;
      }
      break;
    }
    case "double_energy": {
      // 双倍能量：获得等同于当前能量的能量。
      if (actor.side === "player") {
        combat.energy += combat.energy;
      }
      break;
    }
    case "retain_hand": {
      // 平衡：本回合结束时保留全部手牌。
      if (actor.side === "player") {
        combat.retainHandThisTurn = true;
      }
      break;
    }
    case "exhaust_hand_gain_energy": {
      // 回收：消耗手牌中费用最高的一张，获得 = 其费用的能量（自动取最贵）。
      if (actor.side === "player" && combat.hand.length > 0) {
        let picked: CardInstance | null = null;
        let pickedCost = -1;
        for (const card of combat.hand) {
          const cardCost = card.costZero ? 0 : (costOf(getCardDef(card.defId), card.upgraded) ?? 0);
          if (cardCost > pickedCost) {
            pickedCost = cardCost;
            picked = card;
          }
        }
        if (picked) {
          const idx = combat.hand.indexOf(picked);
          combat.hand.splice(idx, 1);
          exhaustCard(state, picked);
          combat.energy += Math.max(0, pickedCost);
        }
      }
      break;
    }
    case "shuffle_discard_into_draw": {
      // 深呼吸：把弃牌堆洗入抽牌堆。
      if (actor.side === "player") {
        combat.drawPile.push(...combat.discardPile);
        combat.discardPile = [];
        shuffleInPlace(state.rng, combat.drawPile);
      }
      break;
    }
    case "deal_damage_kill_maxhp": {
      // 喂养：造成 base；若击杀目标，永久提升最大生命并回复等量。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const enemy = combat.enemies[targetEnemyIndex]!;
        const wasAlive = enemy.hp > 0;
        dealDamageToEnemy(state, targetEnemyIndex, effect.base, powers);
        if (wasAlive && enemy.hp <= 0) {
          state.maxHp += effect.maxhp;
          state.hp += effect.maxhp;
        }
      }
      break;
    }
    case "deal_damage_kill_gold": {
      // 贪婪之手：造成 base；若击杀目标，获得金币。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const enemy = combat.enemies[targetEnemyIndex]!;
        const wasAlive = enemy.hp > 0;
        dealDamageToEnemy(state, targetEnemyIndex, effect.base, powers);
        if (wasAlive && enemy.hp <= 0) {
          state.gold += effect.gold;
        }
      }
      break;
    }
    case "deal_damage_ritual": {
      // 仪式匕首：造成 base+本牌 bonus；若击杀，本牌 bonus += grow。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const enemy = combat.enemies[targetEnemyIndex]!;
        const wasAlive = enemy.hp > 0;
        dealDamageToEnemy(state, targetEnemyIndex, effect.base + (sourceCard?.bonus ?? 0), powers);
        if (wasAlive && enemy.hp <= 0 && sourceCard) {
          sourceCard.bonus = (sourceCard.bonus ?? 0) + effect.grow;
        }
      }
      break;
    }
    case "gain_strength_if_target_attacking": {
      // 觅敌之弱：若目标意图为攻击，获得力量。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        if (enemyIntentIsAttack(combat.enemies[targetEnemyIndex]!)) {
          addPower(combat.playerPowers, "strength", effect.amount);
        }
      }
      break;
    }
    case "deal_damage_weak_if_attacking": {
      // 瞄准眼睛：造成 base；若目标意图为攻击，施加虚弱。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const attacking = enemyIntentIsAttack(combat.enemies[targetEnemyIndex]!);
        dealDamageToEnemy(state, targetEnemyIndex, effect.base, powers);
        const enemy = combat.enemies[targetEnemyIndex]!;
        if (attacking && enemy.hp > 0) {
          applyPowerToEnemy(enemy, "weak", effect.weak);
        }
      }
      break;
    }
    case "put_discard_card_on_top": {
      // 头槌：把弃牌堆最近一张牌置于抽牌堆顶（drawPile 末端为顶）。
      if (actor.side === "player" && combat.discardPile.length > 0) {
        combat.drawPile.push(combat.discardPile.pop()!);
      }
      break;
    }
    case "fetch_from_draw": {
      // 秘密武器/技巧/搜寻：从抽牌堆检索一张（指定类型则限该类型）到手牌。
      if (actor.side === "player") {
        const idx = combat.drawPile.findIndex(
          c => effect.cardType === undefined || getCardDef(c.defId).type === effect.cardType,
        );
        if (idx >= 0 && combat.hand.length < MAX_HAND_SIZE) {
          combat.hand.push(combat.drawPile.splice(idx, 1)[0]!);
        }
      }
      break;
    }
    case "add_random_colorless": {
      // 全能：将随机无色卡加入手牌。
      if (actor.side === "player") {
        const pool = rewardCardPoolOf("colorless");
        for (let n = 0; n < effect.count && pool.length > 0; n += 1) {
          const defId = pool[nextInt(state.rng, pool.length)]!;
          combat.hand.push({ uid: state.nextUid++, defId, upgraded: false });
        }
      }
      break;
    }
    case "deal_damage_all_if_draw_empty": {
      // 大结局：仅当抽牌堆为空时，对所有敌人造成 amount。
      if (actor.side === "player" && combat.drawPile.length === 0) {
        for (let i = 0; i < combat.enemies.length; i += 1) {
          if (combat.enemies[i]!.hp > 0) {
            dealDamageToEnemy(state, i, effect.amount, powers);
          }
        }
      }
      break;
    }
    case "deal_damage_kill_energy": {
      // 分裂：造成 base；若击杀目标，获得 energy 能量。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const enemy = combat.enemies[targetEnemyIndex]!;
        const wasAlive = enemy.hp > 0;
        dealDamageToEnemy(state, targetEnemyIndex, effect.base, powers);
        if (wasAlive && enemy.hp <= 0) {
          combat.energy += effect.energy;
        }
      }
      break;
    }
    case "deal_damage_gain_block_dealt": {
      // 痛打：造成 base，获得等同于实际造成伤害的格挡。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const enemy = combat.enemies[targetEnemyIndex]!;
        const before = enemy.hp;
        dealDamageToEnemy(state, targetEnemyIndex, effect.base, powers);
        const dealt = before - enemy.hp;
        if (dealt > 0) {
          applyEffect(state, { kind: "gain_block", amount: dealt }, actor, targetEnemyIndex);
        }
      }
      break;
    }
    case "reboot": {
      // 重启：手牌与弃牌堆全部洗回抽牌堆，然后抽 draw 张。
      if (actor.side === "player") {
        combat.drawPile.push(...combat.hand, ...combat.discardPile);
        combat.hand = [];
        combat.discardPile = [];
        shuffleInPlace(state.rng, combat.drawPile);
        drawCards(state, effect.draw);
      }
      break;
    }
    case "make_random_hand_card_free": {
      // 疯狂：随机使一张可打出的手牌本场费用变 0。
      if (actor.side === "player") {
        const candidates = combat.hand.filter(
          c => getCardDef(c.defId).cost !== null && !c.costZero,
        );
        if (candidates.length > 0) {
          candidates[nextInt(state.rng, candidates.length)]!.costZero = true;
        }
      }
      break;
    }
    case "put_hand_card_on_top": {
      // 未雨绸缪：将一张手牌（非本牌）置于抽牌堆顶。
      if (actor.side === "player") {
        const idx = combat.hand.findIndex(c => c !== sourceCard);
        if (idx >= 0) {
          combat.drawPile.push(combat.hand.splice(idx, 1)[0]!);
        }
      }
      break;
    }
    case "return_discard_to_hand": {
      // 全息影像：将弃牌堆最近一张牌收回手牌。
      if (
        actor.side === "player" &&
        combat.discardPile.length > 0 &&
        combat.hand.length < MAX_HAND_SIZE
      ) {
        combat.hand.push(combat.discardPile.pop()!);
      }
      break;
    }
    case "recursion": {
      // 递归：唤醒最左侧球，再把同类型球重新充能到末位。
      if (actor.side === "player" && combat.orbs.length > 0) {
        const type = combat.orbs[0]!.type;
        evokeOrb(state, 0);
        channelOrb(state, type);
      }
      break;
    }
    case "discard_hand_for_shivs": {
      // 钢铁风暴：弃掉全部手牌，每弃一张将 1 张飞刀加入手牌。
      if (actor.side === "player") {
        const discarded = [...combat.hand];
        combat.hand = [];
        for (const card of discarded) {
          discardFromHand(state, card);
        }
        for (let n = 0; n < discarded.length; n += 1) {
          combat.hand.push({ uid: state.nextUid++, defId: "shiv", upgraded: false });
        }
      }
      break;
    }
    case "gain_block_draw_if_last_skill": {
      // 神圣：获得格挡；若上一张打出的是技能牌则抽牌。
      if (actor.side === "player") {
        applyEffect(state, { kind: "gain_block", amount: effect.block }, actor, targetEnemyIndex);
        if (combat.lastCardType === "skill") {
          drawCards(state, effect.draw);
        }
      }
      break;
    }
    case "deal_or_enter_wrath": {
      // 义愤：处于愤怒则令所有敌人易伤，否则进入愤怒。
      if (actor.side === "player") {
        if (combat.playerStance === "wrath") {
          for (const enemy of combat.enemies) {
            if (enemy.hp > 0) {
              applyPowerToEnemy(enemy, "vulnerable", effect.vuln);
            }
          }
        } else {
          enterStance(state, "wrath");
        }
      }
      break;
    }
    case "draw_or_enter_calm": {
      // 内心平静：处于平静则抽牌，否则进入平静。
      if (actor.side === "player") {
        if (combat.playerStance === "calm") {
          drawCards(state, effect.draw);
        } else {
          enterStance(state, "calm");
        }
      }
      break;
    }
    case "deal_damage_if_hand_all_attacks": {
      // 招牌动作：若手牌其余全为攻击牌，对目标造成 amount（本牌已离手，故只看剩余手牌）。
      if (actor.side === "player" && targetEnemyIndex !== null) {
        const allAttacks = combat.hand.every(c => getCardDef(c.defId).type === "attack");
        if (allAttacks) {
          dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
        }
      }
      break;
    }
    case "exhaust_random": {
      // 坚毅：随机消耗 count 张手牌（走 exhaustCard 触发无痛/暗黑拥抱）。
      if (actor.side === "player") {
        for (let n = 0; n < effect.count && combat.hand.length > 0; n += 1) {
          const idx = nextInt(state.rng, combat.hand.length);
          exhaustCard(state, combat.hand.splice(idx, 1)[0]!);
        }
      }
      break;
    }
    default: {
      const _exhaustive: never = effect;
      void _exhaustive;
    }
  }
}

function applyPowerEffect(
  state: GameState,
  power: PowerInstance["id"],
  amount: number,
  on: "self" | "target" | "all_enemies",
  actor: ActorRef,
  targetEnemyIndex: number | null,
): void {
  const combat = state.combat!;
  if (on === "self") {
    addPower(actorPowers(state, actor), power, amount);
    return;
  }
  if (on === "all_enemies") {
    for (const enemy of combat.enemies) {
      if (enemy.hp > 0) {
        applyPowerToEnemy(enemy, power, amount);
      }
    }
    return;
  }
  // on === "target"
  if (actor.side === "player") {
    if (targetEnemyIndex !== null) {
      applyPowerToEnemy(combat.enemies[targetEnemyIndex]!, power, amount);
    }
  } else {
    applyPowerToPlayer(combat, power, amount);
  }
}

const DEBUFF_POWERS: ReadonlySet<PowerInstance["id"]> = new Set([
  "vulnerable",
  "weak",
  "frail",
  "entangled",
  "poison",
  "lock_on",
  "choked",
]);

/** 给敌人加 power；若是减益且敌人有神器，则消耗一层神器抵消（哨卫）。 */
function applyPowerToEnemy(enemy: EnemyState, power: PowerInstance["id"], amount: number): void {
  if (DEBUFF_POWERS.has(power) && amount > 0 && getPower(enemy.powers, "artifact") > 0) {
    addPower(enemy.powers, "artifact", -1);
    return;
  }
  addPower(enemy.powers, power, amount);
}

/** 给玩家加 power；若是减益且玩家有神器，则消耗一层神器抵消（远古药水）。 */
function applyPowerToPlayer(combat: CombatState, power: PowerInstance["id"], amount: number): void {
  if (DEBUFF_POWERS.has(power) && amount > 0 && getPower(combat.playerPowers, "artifact") > 0) {
    addPower(combat.playerPowers, "artifact", -1);
    return;
  }
  addPower(combat.playerPowers, power, amount);
}

function addCards(
  state: GameState,
  cardId: string,
  pile: "draw" | "discard" | "hand",
  count: number,
): void {
  const combat = state.combat!;
  // 掌控现实：战斗中生成的牌进场即升级。
  const created = getPower(combat.playerPowers, "master_reality") > 0;
  for (let i = 0; i < count; i += 1) {
    const instance: CardInstance = { uid: state.nextUid++, defId: cardId, upgraded: created };
    if (pile === "hand") {
      if (combat.hand.length >= MAX_HAND_SIZE) {
        combat.discardPile.push(instance);
      } else {
        combat.hand.push(instance);
      }
    } else if (pile === "draw") {
      // 洗入抽牌堆的随机位置（狂野劈砍的伤口：不保证下一张就抽到）。
      const at = nextInt(state.rng, combat.drawPile.length + 1);
      combat.drawPile.splice(at, 0, instance);
    } else {
      combat.discardPile.push(instance);
    }
  }
}

// —— 伤害落地 ——

/** 尸爆：带尸爆标记的敌人死亡时，把它的中毒（poisonAmount）施加给其余所有存活敌人。 */
function spreadCorpseBomb(state: GameState, enemyIndex: number, poisonAmount: number): void {
  const combat = state.combat!;
  const dead = combat.enemies[enemyIndex]!;
  if (getPower(dead.powers, "corpse_bomb") <= 0 || poisonAmount <= 0) {
    return;
  }
  for (let i = 0; i < combat.enemies.length; i += 1) {
    if (i !== enemyIndex && combat.enemies[i]!.hp > 0) {
      applyPowerToEnemy(combat.enemies[i]!, "poison", poisonAmount);
    }
  }
}

/** 玩家攻击命中敌人后的通用触发：以手言心（mark→格挡）、淬毒（穿透→中毒）。 */
function onPlayerAttackHit(state: GameState, enemyIndex: number, unblocked: number): void {
  const combat = state.combat!;
  const enemy = combat.enemies[enemyIndex];
  if (!enemy) {
    return;
  }
  // 以手言心：攻击带标记的敌人 → 获得 = 标记层数的格挡。
  const mark = getPower(enemy.powers, "mark");
  if (mark > 0) {
    combat.playerBlock += mark;
  }
  // 淬毒：攻击造成穿透格挡的伤害 → 给该敌人施加 = 层数的中毒。
  const envenom = getPower(combat.playerPowers, "envenom");
  if (envenom > 0 && unblocked > 0 && enemy.hp > 0) {
    applyPowerToEnemy(enemy, "poison", envenom);
  }
}

function dealDamageToEnemy(
  state: GameState,
  enemyIndex: number,
  base: number,
  attackerPowers: readonly PowerInstance[],
  strengthMultiplier = 1,
): number {
  const enemy = state.combat!.enemies[enemyIndex]!;
  if (enemy.hp <= 0) {
    return 0;
  }
  // 蜷缩：首次被攻击**在结算前**获得格挡，能挡住这一击的一部分（issue #234 C5）。
  if (!enemy.curlUpConsumed && getPower(enemy.powers, "curl_up") > 0) {
    enemy.block += getPower(enemy.powers, "curl_up");
    addPower(enemy.powers, "curl_up", -getPower(enemy.powers, "curl_up"));
    enemy.curlUpConsumed = true;
  }
  // 反甲（守卫者防御姿态）：每次被攻击对玩家反弹固定伤害，无视玩家格挡（直接掉血）。
  const sharpHide = getPower(enemy.powers, "sharp_hide");
  if (sharpHide > 0) {
    state.hp = Math.max(0, state.hp - sharpHide);
  }
  let dmg = computeAttackDamage(base, attackerPowers, enemy.powers, strengthMultiplier);
  // 观者姿态对玩家造成伤害的加成：愤怒 ×2，神性 ×3。
  if (state.combat!.playerStance === "wrath") {
    dmg *= 2;
  } else if (state.combat!.playerStance === "divinity") {
    dmg *= 3;
  }
  // 虚无缥缈（敌人）：受到的一切伤害降为 1（复仇魔隔回合无敌）。
  if (getPower(enemy.powers, "intangible") > 0) {
    dmg = Math.min(dmg, 1);
  }
  // 守卫者模式切换：进攻姿态下累计受到的伤害达阈值即切姿态（issue #234 C10）。
  if (enemy.stance === "offensive" && enemy.modeShiftThreshold !== null) {
    enemy.modeShiftAccum += dmg;
  }
  const afterBlock = Math.max(0, dmg - enemy.block);
  enemy.block = Math.max(0, enemy.block - dmg);
  const wasAlive = enemy.hp > 0;
  enemy.hp = Math.max(0, enemy.hp - afterBlock);
  // 亡语：此击致死则结算敌人的死亡效果（真菌兽孢子云给玩家易伤）。
  if (wasAlive && enemy.hp === 0) {
    spreadCorpseBomb(state, enemyIndex, getPower(enemy.powers, "poison")); // 尸爆：被打死时扩散毒。
    const dyingDef = getEnemyDef(enemy.defId);
    if (dyingDef.deathEffects) {
      applyEffects(state, dyingDef.deathEffects, { side: "enemy", index: enemyIndex }, null);
    }
    // 复活：觉醒者首次死亡时满血复活 + 获得力量（二阶段），仅一次。
    if (dyingDef.reviveHp !== undefined && !enemy.hasRevived) {
      enemy.hasRevived = true;
      enemy.hp = dyingDef.reviveHp;
      enemy.block = 0;
      addPower(enemy.powers, "strength", AWAKENED_REVIVE_STRENGTH);
      state.log.push(`${enemy.name}复活了！`);
    }
  }
  // 拉加维林：睡眠中受到穿透格挡的伤害立即苏醒，去掉金属化。
  if (enemy.asleep && afterBlock > 0 && enemy.hp > 0) {
    enemy.asleep = false;
    removePower(enemy.powers, "metallicize");
  }
  // 狂怒（狂暴地精）：每次受到穿透格挡的攻击伤害，获得 = 层数的力量。
  const angry = getPower(enemy.powers, "angry");
  if (angry > 0 && afterBlock > 0 && enemy.hp > 0) {
    addPower(enemy.powers, "strength", angry);
  }
  // 镀甲（带壳寄生虫）：受到穿透格挡的攻击伤害时 -1 层。
  if (afterBlock > 0 && enemy.hp > 0 && getPower(enemy.powers, "plated_armor") > 0) {
    addPower(enemy.powers, "plated_armor", -1);
  }
  // 半血分裂：降到 ≤maxHp/2 且未分裂过 → 下一动作强制变分裂。
  const def = getEnemyDef(enemy.defId);
  if (def.splitInto && !enemy.hasSplit && enemy.hp > 0 && enemy.hp <= Math.floor(enemy.maxHp / 2)) {
    enemy.hasSplit = true;
    enemy.currentMove = "split";
  }
  if (
    enemy.stance === "offensive" &&
    enemy.modeShiftThreshold !== null &&
    enemy.modeShiftAccum >= enemy.modeShiftThreshold &&
    enemy.hp > 0
  ) {
    triggerModeShift(enemy);
  }
  return afterBlock;
}

function triggerModeShift(enemy: EnemyState): void {
  enemy.stance = "defensive";
  enemy.block += GUARDIAN_SHIFT_BLOCK;
  enemy.modeShiftAccum = 0;
  enemy.modeShiftThreshold = (enemy.modeShiftThreshold ?? 0) + GUARDIAN_MODE_SHIFT_STEP;
  // 立即重新 telegraph 到防御链首招（防御形态）；rotationIndex=1 表示该首招已消费，
  // 下次 selectNextMove 从防御链第 2 招（滚压）续，见 selectNextMove 的 Boss 分支。
  const def = getEnemyDef(enemy.defId);
  enemy.currentMove = def.stanceMoves!.defensive[0]!;
  enemy.rotationIndex = 1;
}

function dealDamageToPlayer(
  state: GameState,
  base: number,
  attackerPowers: readonly PowerInstance[],
  attackerIndex?: number,
): void {
  const combat = state.combat!;
  let dmg = computeAttackDamage(base, attackerPowers, combat.playerPowers);
  // 愤怒姿态（观者）：玩家受到的伤害也翻倍。
  if (combat.playerStance === "wrath") {
    dmg *= 2;
  }
  // 虚无缥缈：受到的一切伤害降为 1。
  if (getPower(combat.playerPowers, "intangible") > 0) {
    dmg = Math.min(dmg, 1);
  }
  let afterBlock = Math.max(0, dmg - combat.playerBlock);
  combat.playerBlock = Math.max(0, combat.playerBlock - dmg);
  // 缓冲：抵消这次会让你失去生命的穿透伤害（消耗 1 层）。
  if (afterBlock > 0 && getPower(combat.playerPowers, "buffer") > 0) {
    addPower(combat.playerPowers, "buffer", -1);
    afterBlock = 0;
  }
  if (afterBlock > 0) {
    state.hp = Math.max(0, state.hp - afterBlock);
    combat.timesLostHpThisCombat += 1; // 血债血偿按本场失血次数降费。
  }
  // 镀甲：受到穿透格挡的攻击伤害时 -1 层。
  if (afterBlock > 0 && getPower(combat.playerPowers, "plated_armor") > 0) {
    addPower(combat.playerPowers, "plated_armor", -1);
  }
  // 静电放电：受到穿透格挡的攻击伤害 → 充能 = 层数的闪电球（机器人）。
  const staticDischarge = getPower(combat.playerPowers, "static_discharge");
  if (afterBlock > 0 && staticDischarge > 0) {
    for (let n = 0; n < staticDischarge; n += 1) {
      channelOrb(state, "lightning");
    }
  }
  // 荆棘 + 火焰屏障：每次被攻击对攻击者反弹固定伤害（无视其格挡，直接掉血）。
  const reflect =
    getPower(combat.playerPowers, "thorns") + getPower(combat.playerPowers, "flame_barrier");
  if (reflect > 0 && attackerIndex !== undefined) {
    const attacker = combat.enemies[attackerIndex];
    if (attacker && attacker.hp > 0) {
      attacker.hp = Math.max(0, attacker.hp - reflect);
    }
  }
}

// —— 姿态（观者）——

const CALM_EXIT_ENERGY = 2; // 离开平静姿态回复的能量。
const MANTRA_THRESHOLD = 10; // 法力达到即进入神性姿态。
const DIVINITY_ENTER_ENERGY = 3; // 进入神性姿态获得的能量。

/** 进入某姿态：离开平静时 +2 能量；同姿态则无事发生。 */
function enterStance(state: GameState, stance: PlayerStance): void {
  const combat = state.combat!;
  if (combat.playerStance === stance) {
    return;
  }
  if (combat.playerStance === "calm" && stance !== "calm") {
    combat.energy += CALM_EXIT_ENERGY;
  }
  combat.playerStance = stance;
  // 心之堡垒：每次姿态改变获得 = 层数的格挡。
  const mentalFortress = getPower(combat.playerPowers, "mental_fortress");
  if (mentalFortress > 0) {
    combat.playerBlock += mentalFortress;
  }
  // 疾攻：进入愤怒姿态时抽 = 层数的牌。
  if (stance === "wrath") {
    const rushdown = getPower(combat.playerPowers, "rushdown");
    if (rushdown > 0) {
      drawCards(state, rushdown);
    }
  }
  // 连绵拳：每次姿态改变，将弃牌堆里的所有「连绵拳」收回手牌（手满则留在弃牌堆）。
  for (let i = combat.discardPile.length - 1; i >= 0; i -= 1) {
    if (combat.discardPile[i]!.defId === "flurry_of_blows" && combat.hand.length < MAX_HAND_SIZE) {
      combat.hand.push(combat.discardPile.splice(i, 1)[0]!);
    }
  }
}

/** 累积法力：达到 10 层自动进入神性姿态（清空法力、+3 能量）。 */
function gainMantra(state: GameState, amount: number): void {
  const combat = state.combat!;
  combat.mantraGainedThisCombat += amount; // 璀璨光辉按本场累计法力结算。
  combat.mantra += amount;
  if (combat.mantra >= MANTRA_THRESHOLD) {
    combat.mantra -= MANTRA_THRESHOLD;
    enterStance(state, "divinity");
    combat.energy += DIVINITY_ENTER_ENERGY;
  }
}

/**
 * 预知（观者）：看抽牌堆顶 amount 张（drawPile 末端为顶），自动弃掉其中的状态牌、
 * 其余保持原序留在顶端（自动解算，不开交互选牌子界面）。发生一次预知触发涅槃格挡。
 */
function doScry(state: GameState, amount: number): void {
  const combat = state.combat!;
  const n = Math.min(amount, combat.drawPile.length);
  if (n <= 0) {
    return;
  }
  const topStart = combat.drawPile.length - n;
  const looked = combat.drawPile.splice(topStart, n); // 取出顶部 n 张
  const kept: CardInstance[] = [];
  for (const card of looked) {
    if (getCardDef(card.defId).type === "status") {
      combat.discardPile.push(card); // 状态牌自动弃掉
    } else {
      kept.push(card);
    }
  }
  combat.drawPile.push(...kept); // 其余按原序放回顶端
  // 涅槃：每次预知获得 = 层数的格挡。
  const nirvana = getPower(combat.playerPowers, "nirvana");
  if (nirvana > 0) {
    combat.playerBlock += nirvana;
  }
  // 编织：每次预知，把弃牌堆里的所有「编织」收回手牌（手满则留在弃牌堆）。
  for (let i = combat.discardPile.length - 1; i >= 0; i -= 1) {
    if (combat.discardPile[i]!.defId === "weave" && combat.hand.length < MAX_HAND_SIZE) {
      combat.hand.push(combat.discardPile.splice(i, 1)[0]!);
    }
  }
}

// —— 充能球（机器人）——

/** 球的一次伤害命中随机存活敌人：不受力量影响，但受目标易伤放大（orb 伤害语义）。 */
function dealOrbDamage(state: GameState, amount: number): void {
  const combat = state.combat!;
  const living = combat.enemies
    .map((enemy, index) => ({ enemy, index }))
    .filter(entry => entry.enemy.hp > 0);
  if (living.length === 0) {
    return;
  }
  // 靶心：带锁定的敌人受到闪电/暗球伤害 ×1.5。
  const hit = (index: number): void => {
    const lockOn = getPower(combat.enemies[index]!.powers, "lock_on");
    dealDamageToEnemy(state, index, lockOn > 0 ? Math.floor(amount * 1.5) : amount, []);
  };
  // 电动力学：球伤害命中所有存活敌人；否则随机一名。
  if (getPower(combat.playerPowers, "electrodynamics") > 0) {
    for (const entry of living) {
      hit(entry.index);
    }
  } else {
    hit(living[nextInt(state.rng, living.length)]!.index);
  }
}

/** 充能一颗球：球槽满则先唤醒最左侧的球，再把新球放到末位（机器人）。 */
function channelOrb(state: GameState, type: OrbType): void {
  const combat = state.combat!;
  if (combat.orbSlots <= 0) {
    return;
  }
  if (combat.orbs.length >= combat.orbSlots) {
    evokeOrb(state, 0);
  }
  // 暗球带累积伤害容器（初始 0）；其它球不用 value。
  combat.orbs.push(type === "dark" ? { type, value: 0 } : { type });
  if (type === "frost") {
    combat.frostChanneledThisCombat += 1; // 暴风雪按本场充能冰霜数结算。
  }
  if (type === "lightning") {
    combat.lightningChanneledThisCombat += 1; // 雷霆一击按本场充能闪电数结算。
  }
}

/** 唤醒指定槽位的球：触发唤醒效果后移除。 */
function evokeOrb(state: GameState, index: number): void {
  const combat = state.combat!;
  const orb = combat.orbs[index];
  if (!orb) {
    return;
  }
  const focus = getPower(combat.playerPowers, "focus");
  switch (orb.type) {
    case "lightning":
      dealOrbDamage(state, LIGHTNING_EVOKE + focus);
      break;
    case "frost":
      combat.playerBlock += Math.max(0, FROST_EVOKE + focus);
      break;
    case "dark":
      // 暗球唤醒：把累积的伤害打给一个随机敌人。
      dealOrbDamage(state, Math.max(0, orb.value ?? 0));
      break;
    case "plasma":
      combat.energy += PLASMA_EVOKE_ENERGY;
      break;
  }
  combat.orbs.splice(index, 1);
}

/** 单颗球触发一次被动（供全体被动与「循环」额外触发共用）。 */
function triggerOneOrbPassive(state: GameState, orb: Orb): void {
  const combat = state.combat!;
  const focus = getPower(combat.playerPowers, "focus");
  switch (orb.type) {
    case "lightning":
      dealOrbDamage(state, LIGHTNING_PASSIVE + focus);
      break;
    case "frost":
      combat.playerBlock += Math.max(0, FROST_PASSIVE + focus);
      break;
    case "dark":
      // 暗球被动：累积 = 6+集中 的伤害（存到自身 value，唤醒时一次打出）。
      orb.value = (orb.value ?? 0) + Math.max(0, DARK_PASSIVE + focus);
      break;
    case "plasma":
      combat.energy += PLASMA_PASSIVE_ENERGY;
      break;
  }
}

/** 回合结束时所有球触发被动（闪电随机伤害 / 冰霜格挡 / 暗球累积 / 等离子给能量）。 */
function triggerOrbPassives(state: GameState): void {
  const combat = state.combat!;
  for (const orb of combat.orbs) {
    triggerOneOrbPassive(state, orb);
  }
}

/** 无来源的固定伤害（灼烧废牌），经玩家格挡但不受力量/易伤影响。 */
function applyBurnDamage(state: GameState, amount: number): void {
  const combat = state.combat!;
  const afterBlock = Math.max(0, amount - combat.playerBlock);
  combat.playerBlock = Math.max(0, combat.playerBlock - amount);
  state.hp = Math.max(0, state.hp - afterBlock);
}

// —— 玩家出牌 ——

export type PlayCardResult = { ok: true } | { ok: false; reason: string };

export function playCard(
  state: GameState,
  handIndex: number,
  targetIndex: number | null,
): PlayCardResult {
  const combat = state.combat;
  if (!combat || state.screen !== "combat") {
    return { ok: false, reason: "现在不在战斗中。" };
  }
  const instance = combat.hand[handIndex];
  if (!instance) {
    return { ok: false, reason: `手牌位 ${handIndex} 无效。` };
  }
  const def = getCardDef(instance.defId);
  if (def.type === "attack" && getPower(combat.playerPowers, "entangled") > 0) {
    return { ok: false, reason: "你被缠绕了，本回合无法打出攻击牌。" };
  }
  // 常态（诅咒）：手牌里有常态时，本回合最多打出 3 张牌。
  if (combat.cardsPlayedThisTurn >= 3 && combat.hand.some(card => card.defId === "normality")) {
    return { ok: false, reason: "常态诅咒让你本回合无法再打出牌了。" };
  }
  const rawCost = costOf(def, instance.upgraded);
  if (rawCost === null) {
    return { ok: false, reason: `「${def.name}」无法打出。` };
  }
  // 腐化：技能牌费用变 0（打出后消耗，见下方入堆处理）。
  const corrupted = def.type === "skill" && getPower(combat.playerPowers, "corruption") > 0;
  // 动态降费：剖体斩按本回合弃牌数、力场按本场能力牌数、血债血偿按本场失血次数（下限 0）。
  let costReduction = 0;
  if (def.costMinusDiscardThisTurn) {
    costReduction += combat.cardsDiscardedThisTurn;
  }
  if (def.costMinusPowersPlayedThisCombat) {
    costReduction += combat.powersPlayedThisCombat;
  }
  if (def.costMinusHpLossCountThisCombat) {
    costReduction += combat.timesLostHpThisCombat;
  }
  // 流水线：本实例本场累计的永久降费。
  costReduction += instance.costReduction ?? 0;
  // 巧计一击：费用按本场失血次数上调（负降费）。
  if (def.costPlusHpLossCountThisCombat) {
    costReduction -= combat.timesLostHpThisCombat;
  }
  const discountedRawCost = Math.max(0, rawCost - costReduction);
  // 回身步：下一张攻击牌费用视为 0（打出后消耗一层）。
  const freeAttack = def.type === "attack" && getPower(combat.playerPowers, "free_attack") > 0;
  // costZero（疯狂使其免费）或腐化时费用视为 0。
  let cost = corrupted || instance.costZero || freeAttack ? 0 : discountedRawCost;
  // 顿悟：本回合费用上限（把费用压到不超过 costCapThisTurn）。
  if (instance.costCapThisTurn !== undefined) {
    cost = Math.min(cost, instance.costCapThisTurn);
  }
  if (cost > combat.energy) {
    return { ok: false, reason: `能量不足：需 ${cost}，剩 ${combat.energy}。` };
  }

  let resolvedTarget: number | null = null;
  if (def.targeted) {
    const living = combat.enemies
      .map((enemy, index) => ({ enemy, index }))
      .filter(entry => entry.enemy.hp > 0);
    if (
      targetIndex !== null &&
      combat.enemies[targetIndex] &&
      combat.enemies[targetIndex]!.hp > 0
    ) {
      resolvedTarget = targetIndex;
    } else if (living.length === 1) {
      resolvedTarget = living[0]!.index;
    } else {
      return { ok: false, reason: "这张牌需要指定一个存活的敌人目标。" };
    }
  }

  // X 费牌：X = 当前全部能量，消耗全部能量，effects 里的 *_x 按 X 结算。
  const xValue = def.xCost ? combat.energy : 0;
  combat.energy -= def.xCost ? combat.energy : cost;
  combat.hand.splice(handIndex, 1);
  // 出牌计数（超光速见「本张已计入」故先增；华彩每 5 张触发靠它）。回合始清零。
  combat.cardsPlayedThisTurn += 1;
  // 爆发/增幅/回响：记下结算前的层数，避免施加这些效果的牌把自己也翻倍。
  const burstBefore = getPower(combat.playerPowers, "burst");
  const amplifyBefore = getPower(combat.playerPowers, "amplify");
  const echoBefore = getPower(combat.playerPowers, "echo_form");
  applyEffects(
    state,
    effectsOf(def, instance.upgraded),
    { side: "player" },
    resolvedTarget,
    xValue,
    instance,
  );
  // 爆发：接下来的技能各额外结算一次（消耗 1 层）；不作用于施加爆发的这张牌本身。
  if (def.type === "skill" && burstBefore > 0) {
    addPower(combat.playerPowers, "burst", -1);
    applyEffects(
      state,
      effectsOf(def, instance.upgraded),
      { side: "player" },
      resolvedTarget,
      xValue,
      instance,
    );
  }
  // 增幅：接下来的能力牌各额外结算一次（消耗 1 层）；不作用于施加增幅的这张牌本身。
  if (def.type === "power" && amplifyBefore > 0) {
    addPower(combat.playerPowers, "amplify", -1);
    applyEffects(
      state,
      effectsOf(def, instance.upgraded),
      { side: "player" },
      resolvedTarget,
      xValue,
      instance,
    );
  }
  // 回响形态：每回合你打出的第一张牌额外结算一次；不作用于施加回响的这张牌本身。
  if (echoBefore > 0 && combat.cardsPlayedThisTurn === 1) {
    applyEffects(
      state,
      effectsOf(def, instance.upgraded),
      { side: "player" },
      resolvedTarget,
      xValue,
      instance,
    );
  }
  // 连击：接下来的攻击各额外结算一次（消耗 1 层）。
  if (def.type === "attack" && getPower(combat.playerPowers, "double_tap") > 0) {
    addPower(combat.playerPowers, "double_tap", -1);
    applyEffects(
      state,
      effectsOf(def, instance.upgraded),
      { side: "player" },
      resolvedTarget,
      xValue,
      instance,
    );
  }
  // 终结技计数：本回合已打出的攻击牌 +1（在效果结算后，故本张攻击不计入自身）。
  if (def.type === "attack") {
    combat.attacksThisTurn += 1;
    // 回身步：本张攻击享受免费后，消耗一层。
    if (freeAttack) {
      removePower(combat.playerPowers, "free_attack");
    }
    // 暴怒：本回合每打出一张攻击牌，获得 = 层数的格挡。
    const rage = getPower(combat.playerPowers, "rage");
    if (rage > 0) {
      combat.playerBlock += rage;
    }
  }
  // 激怒（地精头目）：玩家每打出一张技能牌，带激怒的敌人获得 = 层数的力量。
  if (def.type === "skill") {
    for (const enemy of combat.enemies) {
      const enrage = getPower(enemy.powers, "enrage");
      if (enemy.hp > 0 && enrage > 0) {
        addPower(enemy.powers, "strength", enrage);
      }
    }
  }
  if (def.type === "power") {
    // 能力牌打出后离场（效果转为常驻 power），不入任何牌堆，本场不再抽到。
    combat.powersPlayedThisCombat += 1; // 力场按本场打出的能力牌数降费。
  } else if (def.exhausts || corrupted) {
    // 腐化下技能牌也消耗。
    exhaustCard(state, instance);
  } else {
    combat.discardPile.push(instance);
  }
  state.log.push(`你打出「${def.name}」。`);
  // 流水线：每打出一次，本实例本场永久 -1 费。
  if (def.costReducesOnPlay) {
    instance.costReduction = (instance.costReduction ?? 0) + 1;
  }
  // 记录本张类型供下一张牌判据（神圣「上一张是技能」）用。
  combat.lastCardType = def.type;
  // 出牌计数遗物（手里剑/苦无/装饰扇按攻击计数、鸟面瓮按能力回血…）。
  triggerRelicCardPlayed(state, def.type);
  // 打牌触发型玩家能力（千刃对全体、残影加格挡）。
  triggerPlayerCardPlayed(state, def.type);
  // 华彩：本回合每打出满 5 张牌，对所有敌人造成 = 层数的伤害。
  const panache = getPower(combat.playerPowers, "panache");
  if (panache > 0 && combat.cardsPlayedThisTurn % 5 === 0) {
    for (let i = 0; i < combat.enemies.length; i += 1) {
      if (combat.enemies[i]!.hp > 0) {
        dealDamageToEnemy(state, i, panache, []);
      }
    }
  }

  resolveCombatIfEnded(state);
  // 反甲反噬等可能在自己回合内把玩家打死：战斗未结束但玩家已倒下 → 判负。
  if (state.combat !== null && state.hp <= 0) {
    state.screen = "gameover";
    state.log.push("你倒下了。");
  }
  // 终局 / 时间扭曲：带「结束回合」效果的牌，或本回合触发了时间扭曲，
  // 打出结算后若战斗仍在进行则立即结束本回合。
  if (state.combat !== null && state.screen === "combat") {
    const endsTurn =
      combat.timeWarpEndTurnPending ||
      effectsOf(def, instance.upgraded).some(candidate => candidate.kind === "end_turn");
    combat.timeWarpEndTurnPending = false;
    if (endsTurn) {
      endTurn(state);
    }
  }
  return { ok: true };
}

/** 分裂：index 处的敌人消失，用分裂体替换（各自 HP = 分裂瞬间当前值），并 telegraph 它们。 */
function performSplit(state: GameState, index: number): void {
  const combat = state.combat!;
  const splitter = combat.enemies[index]!;
  const def = getEnemyDef(splitter.defId);
  const hp = splitter.hp;
  const spawnIds = def.splitInto ?? [];
  const spawns = spawnIds.map(id => createEnemyState(state, id, hp));
  if (spawns.length === 0) {
    return;
  }
  combat.enemies[index] = spawns[0]!;
  selectNextMove(state, index);
  for (let k = 1; k < spawns.length; k += 1) {
    const newIndex = combat.enemies.length;
    combat.enemies.push(spawns[k]!);
    selectNextMove(state, newIndex);
  }
  state.log.push(`${def.name}分裂了！`);
}

// —— 使用药水 ——

export type UsePotionResult = { ok: true } | { ok: false; reason: string };

export function usePotion(
  state: GameState,
  slotIndex: number,
  targetIndex: number | null,
): UsePotionResult {
  const potionId = state.potions[slotIndex];
  if (potionId === undefined || potionId === null) {
    return { ok: false, reason: `药水槽 ${slotIndex} 是空的。` };
  }
  const def = getPotionDef(potionId);
  const combat = state.combat;
  if (def.combatOnly && (!combat || state.screen !== "combat")) {
    return { ok: false, reason: `「${def.name}」只能在战斗中使用。` };
  }

  let resolvedTarget: number | null = null;
  if (def.targeted && combat) {
    const living = combat.enemies
      .map((enemy, index) => ({ enemy, index }))
      .filter(entry => entry.enemy.hp > 0);
    if (
      targetIndex !== null &&
      combat.enemies[targetIndex] &&
      combat.enemies[targetIndex]!.hp > 0
    ) {
      resolvedTarget = targetIndex;
    } else if (living.length === 1) {
      resolvedTarget = living[0]!.index;
    } else {
      return { ok: false, reason: "这瓶药水需要指定一个存活的敌人目标。" };
    }
  }

  state.potions[slotIndex] = null; // 药水一次性，先清槽再结算。
  applyEffects(state, def.effects, { side: "player" }, resolvedTarget);
  state.log.push(`你使用了「${def.name}」。`);
  if (combat) {
    resolveCombatIfEnded(state);
  }
  return { ok: true };
}

// —— 结束回合 / 敌人行动 ——

export function endTurn(state: GameState): void {
  const combat = state.combat;
  if (!combat || state.screen !== "combat") {
    return;
  }
  // 回合结束：手牌中每张灼烧对玩家造成 2 点伤害（经格挡，六火之灵）。
  const burnCount = combat.hand.filter(instance => instance.defId === "burn").length;
  for (let i = 0; i < burnCount; i += 1) {
    applyBurnDamage(state, BURN_DAMAGE);
  }
  // 收集手牌里「回合末在手」的效果（诅咒腐朽自伤、疑虑虚弱、羞愧脆弱等）；
  // 在玩家 debuff 衰减之后再结算，避免本回合刚施加的虚弱/脆弱立刻被衰减掉。
  // 悔恨等「按手牌张数」的效果在此刻（手牌还完整时）把张数固化，避免清手后读到 0。
  const handSizeAtTurnEnd = combat.hand.length;
  const endOfHandEffects = combat.hand.flatMap(instance =>
    (getCardDef(instance.defId).endOfTurnInHand ?? []).map(
      (candidate): Effect =>
        candidate.kind === "lose_hp_per_hand_card"
          ? { kind: "lose_hp", amount: handSizeAtTurnEnd }
          : candidate,
    ),
  );
  if (state.hp <= 0) {
    state.screen = "gameover";
    state.log.push("你倒下了。");
    return;
  }
  // 玩家回合结束：保留牌留在手中，虚无牌被消耗，其余进弃牌堆；玩家 debuff 衰减。
  const retained: CardInstance[] = [];
  // 深谋远虑：回合结束可额外保留至多 N 张本应弃掉的牌。
  let wellLaidPlans = getPower(combat.playerPowers, "well_laid_plans");
  for (const instance of combat.hand) {
    instance.costCapThisTurn = undefined; // 顿悟「本回合」限定：回合结束清除费用上限。
    const cardDef = getCardDef(instance.defId);
    if (cardDef.retain) {
      retained.push(instance);
    } else if (cardDef.ethereal) {
      combat.exhaustPile.push(instance);
    } else if (combat.retainHandThisTurn) {
      // 平衡：本回合保留全部手牌（虚无牌仍按上面消耗）。
      retained.push(instance);
    } else if (wellLaidPlans > 0) {
      retained.push(instance);
      wellLaidPlans -= 1;
    } else {
      combat.discardPile.push(instance);
    }
  }
  combat.hand = retained;
  combat.retainHandThisTurn = false; // 「本回合」限定：结算后清零。
  // 既定事实：本回合被保留下来的每张牌，费用永久 -establishment（多次保留会叠加下降）。
  const establishment = getPower(combat.playerPowers, "establishment");
  if (establishment > 0) {
    for (const instance of retained) {
      instance.costReduction = (instance.costReduction ?? 0) + establishment;
    }
  }
  // 扼喉「本回合」限定：玩家回合结束时清除所有敌人的扼喉层数。
  for (const enemy of combat.enemies) {
    if (getPower(enemy.powers, "choked") > 0) {
      removePower(enemy.powers, "choked");
    }
  }
  // 幻杀「本回合」限定：回合结束清除双倍。
  if (getPower(combat.playerPowers, "phantasmal") > 0) {
    removePower(combat.playerPowers, "phantasmal");
  }
  // 应急按钮：无法从牌获得格挡的剩余回合数每回合末 -1。
  if (getPower(combat.playerPowers, "no_card_block") > 0) {
    addPower(combat.playerPowers, "no_card_block", -1);
  }
  // 炸弹：回合结束倒计时，归零时对所有敌人造成伤害。
  if (combat.pendingBomb) {
    combat.pendingBomb.turns -= 1;
    if (combat.pendingBomb.turns <= 0) {
      const dmg = combat.pendingBomb.damage;
      combat.pendingBomb = null;
      for (let i = 0; i < combat.enemies.length; i += 1) {
        if (combat.enemies[i]!.hp > 0) {
          dealDamageToEnemy(state, i, dmg, []);
        }
      }
    }
  }
  // 金属化 / 镀甲（玩家）：回合结束获得等量格挡（定值），带进敌人回合防御。
  const playerMetallicize = getPower(combat.playerPowers, "metallicize");
  if (playerMetallicize > 0) {
    combat.playerBlock += playerMetallicize;
  }
  const platedArmor = getPower(combat.playerPowers, "plated_armor");
  if (platedArmor > 0) {
    combat.playerBlock += platedArmor;
  }
  // 再生（玩家）：回合结束回血，然后层数 -1。
  const regen = getPower(combat.playerPowers, "regen");
  if (regen > 0) {
    state.hp = Math.min(state.maxHp, state.hp + regen);
    addPower(combat.playerPowers, "regen", -1);
  }
  // 燃烧：回合结束失 1 生命，并对所有敌人造成 = 层数的伤害。
  const combust = getPower(combat.playerPowers, "combust");
  if (combust > 0) {
    state.hp = Math.max(0, state.hp - 1);
    if (state.hp <= 0) {
      state.screen = "gameover";
      state.log.push("你倒下了。");
      return;
    }
    applyEffects(state, [{ kind: "deal_damage_all", amount: combust }], { side: "player" }, null);
  }
  // 研习：回合结束将 = 层数张「洞悉」加入抽牌堆。
  const study = getPower(combat.playerPowers, "study");
  if (study > 0) {
    addCards(state, "insight", "draw", study);
  }
  // 奥米加：回合结束对所有敌人造成 50×层数 的伤害。
  const omega = getPower(combat.playerPowers, "omega");
  if (omega > 0) {
    applyEffects(
      state,
      [{ kind: "deal_damage_all", amount: OMEGA_DAMAGE * omega }],
      { side: "player" },
      null,
    );
  }
  // 静如止水：回合结束时若处于平静姿态，获得 = 层数的格挡。
  const likeWater = getPower(combat.playerPowers, "like_water");
  if (likeWater > 0 && combat.playerStance === "calm") {
    combat.playerBlock += likeWater;
  }
  // 神性姿态（观者）：回合结束退出（回到无姿态）。
  if (combat.playerStance === "divinity") {
    combat.playerStance = "none";
  }
  // 充能球被动（机器人）：回合结束时每颗球触发（闪电随机伤害 / 冰霜格挡）。
  triggerOrbPassives(state);
  // 回合结束遗物（山铜：若无格挡则补格挡）——在金属化之后判定。
  triggerRelicTurnEnd(state);
  decayDebuffs(combat.playerPowers);
  // 虚无缥缈：回合结束 -1 层（疾影在下回合始的格挡保留判定之后才 -1，见 turn-start）。
  if (getPower(combat.playerPowers, "intangible") > 0) {
    addPower(combat.playerPowers, "intangible", -1);
  }
  // 临时力量（屈伸）：回合结束失去等量力量后清零本 power。
  const strengthTemp = getPower(combat.playerPowers, "strength_temp");
  if (strengthTemp > 0) {
    addPower(combat.playerPowers, "strength", -strengthTemp);
    removePower(combat.playerPowers, "strength_temp");
  }
  // 暴怒 / 挥手：只在打出它的回合生效，回合结束清除。
  if (getPower(combat.playerPowers, "rage") > 0) {
    removePower(combat.playerPowers, "rage");
  }
  if (getPower(combat.playerPowers, "wave_of_the_hand") > 0) {
    removePower(combat.playerPowers, "wave_of_the_hand");
  }
  // 回合末在手结算（腐朽自伤 / 疑虑虚弱 / 羞愧脆弱）：在衰减之后，让本回合施加的减益延续到敌人回合。
  if (endOfHandEffects.length > 0) {
    applyEffects(state, endOfHandEffects, { side: "player" }, null);
    if (state.hp <= 0) {
      state.screen = "gameover";
      state.log.push("你倒下了。");
      return;
    }
  }

  // 宝库：若预约了额外回合，则本次跳过敌人行动（敌人数封顶为 0），随后直接进入新的玩家回合。
  const skipEnemies = combat.extraTurnPending;
  if (skipEnemies) {
    combat.extraTurnPending = false;
    state.log.push("你获得了一个额外回合。");
  }
  // 敌人回合。用回合开始时的敌人数封顶，分裂新生的敌人本回合不行动。
  const enemyCount = skipEnemies ? 0 : combat.enemies.length;
  for (let i = 0; i < enemyCount; i += 1) {
    const enemy = combat.enemies[i]!;
    if (enemy.hp <= 0 || enemy.escaped) {
      continue;
    }
    // 半血分裂：本体消失，原位与末位各生成一个分裂体（HP = 当前值），本回合不行动。
    if (enemy.currentMove === "split") {
      performSplit(state, i);
      continue;
    }
    enemy.block = 0; // 敌人回合开始清格挡。
    // 中毒：回合开始受到 = 毒层数的伤害（无视格挡），然后毒 -1；毒死则跳过行动。
    const enemyPoison = getPower(enemy.powers, "poison");
    if (enemyPoison > 0) {
      enemy.hp = Math.max(0, enemy.hp - enemyPoison);
      addPower(enemy.powers, "poison", -1);
      if (enemy.hp <= 0) {
        spreadCorpseBomb(state, i, enemyPoison); // 尸爆：毒死时扩散毒。
        continue;
      }
    }
    triggerOnTurnStart(enemy);
    const def = getEnemyDef(enemy.defId);
    const move = def.moves.find(candidate => candidate.id === enemy.currentMove);
    if (move) {
      applyEffects(state, move.effects, { side: "enemy", index: i }, null);
      enemy.moveHistory.push(move.id);
    }
    if (state.hp <= 0) {
      state.screen = "gameover";
      state.log.push("你倒下了。");
      return;
    }
    // 复仇魔：每次出招后若自身没有虚无缥缈则叠加（隔回合无敌）。
    if (def.intangibleAfterMove && getPower(enemy.powers, "intangible") === 0) {
      addPower(enemy.powers, "intangible", def.intangibleAfterMove);
    }
    // 金属化 / 镀甲：自己回合结束获得格挡（拉加维林金属化 8、带壳寄生虫镀甲 14）。
    const metallicize = getPower(enemy.powers, "metallicize");
    if (metallicize > 0) {
      enemy.block += metallicize;
    }
    const enemyPlated = getPower(enemy.powers, "plated_armor");
    if (enemyPlated > 0) {
      enemy.block += enemyPlated;
    }
    decayDebuffs(enemy.powers);
    // 虚无缥缈（敌人）：在自己回合结束 -1 层（隔回合无敌节奏）。
    if (getPower(enemy.powers, "intangible") > 0) {
      addPower(enemy.powers, "intangible", -1);
    }
    // 下一招 telegraph（守卫者的姿态推进与防御→进攻切换在 selectNextMove 内处理）。
    selectNextMove(state, i);
  }

  // 敌人全部逃跑 / 死亡 → 战斗结束（拾荒者逃走后无人可打）。
  resolveCombatIfEnded(state);
  if (state.combat === null) {
    return;
  }

  // 下个玩家回合开始。
  combat.turn += 1;
  combat.lastCardType = null;
  combat.attacksThisTurn = 0;
  combat.cardsDiscardedThisTurn = 0;
  combat.cardsPlayedThisTurn = 0;
  // 黑暗枷锁：敌人被临时削弱的力量在其行动过后（新玩家回合开始）归还，清除枷锁。
  for (const enemy of combat.enemies) {
    const shackled = getPower(enemy.powers, "shackled");
    if (shackled > 0) {
      addPower(enemy.powers, "strength", shackled);
      removePower(enemy.powers, "shackled");
    }
  }
  // 火焰屏障「本回合」限定：作用到敌人回合结束（覆盖被攻击反弹），新玩家回合开始清除。
  if (getPower(combat.playerPowers, "flame_barrier") > 0) {
    removePower(combat.playerPowers, "flame_barrier");
  }
  // 幻杀：预约兑现——本回合攻击双倍。
  if (combat.nextTurnPhantasmal) {
    combat.nextTurnPhantasmal = false;
    addPower(combat.playerPowers, "phantasmal", 1);
  }
  // 噩梦：预约兑现——把牌副本加入手牌。
  if (combat.nightmarePending) {
    addCards(state, combat.nightmarePending.cardId, "hand", combat.nightmarePending.count);
    combat.nightmarePending = null;
  }
  // 亵渎：预约的死亡在新回合兑现。
  if (combat.doomedNextTurn) {
    state.hp = 0;
    state.screen = "gameover";
    state.log.push("你在神性燃尽后倒下了。");
    return;
  }
  // 战意：新回合解除「无法抽牌」。
  if (getPower(combat.playerPowers, "no_draw") > 0) {
    removePower(combat.playerPowers, "no_draw");
  }
  // 壁垒 / 疾影：格挡不在回合开始清空（否则清零）。判定后疾影 -1（只保留一回合）。
  const blur = getPower(combat.playerPowers, "blur");
  if (getPower(combat.playerPowers, "barricade") === 0 && blur === 0) {
    combat.playerBlock = 0;
  }
  if (blur > 0) {
    addPower(combat.playerPowers, "blur", -1);
  }
  combat.energy = combat.maxEnergy;
  // 下回合预约结算（闪转腾挪格挡 / 飞膝能量 / 掠食者抽牌），随后清零。
  combat.playerBlock += combat.nextTurnBlock;
  combat.energy += combat.nextTurnEnergy;
  const scheduledDraw = combat.nextTurnDraw;
  combat.nextTurnBlock = 0;
  combat.nextTurnEnergy = 0;
  combat.nextTurnDraw = 0;
  // 烈怒渐起：预约的姿态在新回合兑现（进入姿态会触发姿态改变类 power）。
  if (combat.nextTurnStance !== null) {
    const scheduled = combat.nextTurnStance;
    combat.nextTurnStance = null;
    enterStance(state, scheduled);
  }
  // 恶魔形态（玩家能力牌）：每个玩家回合开始获得等量力量。
  const demonForm = getPower(combat.playerPowers, "demon_form");
  if (demonForm > 0) {
    addPower(combat.playerPowers, "strength", demonForm);
  }
  // 仪式（玩家·邪教徒药水）：每个玩家回合开始获得等量力量。
  const playerRitual = getPower(combat.playerPowers, "ritual");
  if (playerRitual > 0) {
    addPower(combat.playerPowers, "strength", playerRitual);
  }
  // 中毒（玩家）：回合开始受到 = 毒层数的伤害（无视格挡），然后毒 -1。
  const playerPoison = getPower(combat.playerPowers, "poison");
  if (playerPoison > 0) {
    state.hp = Math.max(0, state.hp - playerPoison);
    addPower(combat.playerPowers, "poison", -1);
    if (state.hp <= 0) {
      state.screen = "gameover";
      state.log.push("你中毒身亡。");
      return;
    }
  }
  // 残暴：回合开始失 = 层数生命、抽 = 层数牌。
  const brutality = getPower(combat.playerPowers, "brutality");
  if (brutality > 0) {
    state.hp = Math.max(0, state.hp - brutality);
    if (state.hp <= 0) {
      state.screen = "gameover";
      state.log.push("你倒下了。");
      return;
    }
    drawCards(state, brutality);
  }
  // 毒雾：回合开始令所有敌人获得 = 层数的中毒。
  const noxiousFumes = getPower(combat.playerPowers, "noxious_fumes");
  if (noxiousFumes > 0) {
    for (const enemy of combat.enemies) {
      if (enemy.hp > 0) {
        applyPowerToEnemy(enemy, "poison", noxiousFumes);
      }
    }
  }
  // 虔诚：回合开始获得 = 层数的法力（可能触发神性）。
  const devotion = getPower(combat.playerPowers, "devotion");
  if (devotion > 0) {
    gainMantra(state, devotion);
  }
  // 无尽之刃：回合开始将 = 层数的飞刀加入手牌。
  const infiniteBlades = getPower(combat.playerPowers, "infinite_blades");
  if (infiniteBlades > 0) {
    addCards(state, "shiv", "hand", infiniteBlades);
  }
  // 偏置认知：回合开始失去 1 点集中。
  if (getPower(combat.playerPowers, "biased_cognition") > 0) {
    addPower(combat.playerPowers, "focus", -1);
  }
  // 战歌：回合开始将 = 层数的痛斩加入手牌。
  const battleHymn = getPower(combat.playerPowers, "battle_hymn");
  if (battleHymn > 0) {
    addCards(state, "smite", "hand", battleHymn);
  }
  // 狂暴：回合开始获得 = 层数的能量。
  const berserk = getPower(combat.playerPowers, "berserk");
  if (berserk > 0) {
    combat.energy += berserk;
  }
  // 循环：回合开始额外触发最左侧球的被动 = 层数次。
  const loop = getPower(combat.playerPowers, "loop");
  if (loop > 0 && combat.orbs.length > 0) {
    for (let n = 0; n < loop; n += 1) {
      triggerOneOrbPassive(state, combat.orbs[0]!);
    }
  }
  // 行业工具：回合开始抽 = 层数的牌，再随机弃 = 层数的牌。
  const tools = getPower(combat.playerPowers, "tools_of_the_trade");
  if (tools > 0) {
    drawCards(state, tools);
    applyEffects(state, [{ kind: "discard_random", count: tools }], { side: "player" }, null);
  }
  // 提婆形态：回合开始获得 = 层数的能量，然后层数 +1（能量逐回合递增）。
  const devaForm = getPower(combat.playerPowers, "deva_form");
  if (devaForm > 0) {
    combat.energy += devaForm;
    addPower(combat.playerPowers, "deva_form", 1);
  }
  // 回合开始遗物（欢乐花能量 / 角锚第二回合格挡 / 水银沙漏回合始发伤）。
  triggerRelicTurnStart(state);
  // 回合始遗物可能（如水银沙漏 AoE）打死全部残敌 → 结算胜利，不再发牌。
  resolveCombatIfEnded(state);
  if (state.combat === null || state.screen !== "combat") {
    return;
  }
  // 未卜先知：回合开始预知 = 层数张（在抽牌前看牌堆顶）。
  const foresight = getPower(combat.playerPowers, "foresight");
  if (foresight > 0) {
    doScry(state, foresight);
  }
  // 机器学习：每回合多抽 = 层数的牌；叠加下回合预约抽牌（掠食者）。
  const machineLearning = getPower(combat.playerPowers, "machine_learning");
  // 抽牌削减（时间吞噬者头槌）：本回合少抽 = 层数张，随后清除（一次性）。
  const drawReduction = getPower(combat.playerPowers, "draw_reduction");
  if (drawReduction > 0) {
    removePower(combat.playerPowers, "draw_reduction");
  }
  drawCards(
    state,
    Math.max(0, STARTING_HAND_SIZE + machineLearning + scheduledDraw - drawReduction),
  );
  // 磁力：每回合开始将 = 层数张随机无色牌加入手牌。
  const magnetism = getPower(combat.playerPowers, "magnetism");
  for (let n = 0; n < magnetism; n += 1) {
    addCards(state, MAGNETISM_POOL[nextInt(state.rng, MAGNETISM_POOL.length)]!, "hand", 1);
  }
  // 你好世界：每回合开始将 = 层数张随机普通牌加入手牌。
  const helloWorld = getPower(combat.playerPowers, "hello_world");
  for (let n = 0; n < helloWorld; n += 1) {
    addCards(state, HELLO_WORLD_POOL[nextInt(state.rng, HELLO_WORLD_POOL.length)]!, "hand", 1);
  }
  // 采集：接下来若干回合各将一张 0 费「洞悉」加入手牌，每回合消耗一层。
  if (getPower(combat.playerPowers, "collect") > 0) {
    const insight: CardInstance = {
      uid: state.nextUid++,
      defId: "insight",
      upgraded: false,
      costZero: true,
    };
    if (combat.hand.length < MAX_HAND_SIZE) {
      combat.hand.push(insight);
    } else {
      combat.discardPile.push(insight);
    }
    addPower(combat.playerPowers, "collect", -1);
  }
  // 混乱：每回合开始，打出抽牌堆顶 = 层数张牌（免费结算，随后按类型正常入堆）。
  const mayhem = getPower(combat.playerPowers, "mayhem");
  for (let n = 0; n < mayhem && combat.drawPile.length > 0; n += 1) {
    const top = combat.drawPile.pop()!;
    const topDef = getCardDef(top.defId);
    let mayhemTarget: number | null = null;
    if (topDef.targeted) {
      const living = combat.enemies
        .map((enemy, index) => ({ enemy, index }))
        .filter(entry => entry.enemy.hp > 0);
      if (living.length > 0) {
        mayhemTarget = living[nextInt(state.rng, living.length)]!.index;
      }
    }
    applyEffects(state, effectsOf(topDef, top.upgraded), { side: "player" }, mayhemTarget, 0, top);
    if (topDef.type === "power") {
      // 能力牌打出后离场。
    } else if (topDef.exhausts) {
      exhaustCard(state, top);
    } else {
      combat.discardPile.push(top);
    }
  }
  // 创意 AI：每回合开始，将 = 层数张随机能力牌加入手牌。
  const creativeAi = getPower(combat.playerPowers, "creative_ai");
  for (let n = 0; n < creativeAi; n += 1) {
    addCards(state, WHITE_NOISE_POOL[nextInt(state.rng, WHITE_NOISE_POOL.length)]!, "hand", 1);
  }
  // 回合开始的抽牌触发效果（火焰吐息随抽到状态牌 AoE、混沌打出牌、荆棘反弹等）可能打死最后的
  // 敌人；此时必须结算胜利，否则会留在「全灭却仍在战斗」的死局里（无合法出牌目标）。
  resolveCombatIfEnded(state);
  if (state.combat === null || state.screen !== "combat") {
    return;
  }
  state.log.push(`第 ${combat.turn} 回合开始。`);
}

function triggerOnTurnStart(enemy: EnemyState): void {
  const ritual = getPower(enemy.powers, "ritual");
  if (ritual > 0) {
    addPower(enemy.powers, "strength", ritual);
  }
}

// —— 敌人意图选择 ——

function selectNextMove(state: GameState, enemyIndex: number): void {
  const combat = state.combat!;
  const enemy = combat.enemies[enemyIndex]!;
  if (enemy.hp <= 0) {
    return;
  }
  const def = getEnemyDef(enemy.defId);

  // 护盾地精：场上还有其他存活友军时保护友军，只剩自己时改攻击。
  if (enemy.defId === "shield_gremlin") {
    enemy.currentMove = livingEnemies(combat).length > 1 ? "protect" : "shield_bash";
    return;
  }

  // 地精巫师：蓄力 3 回合 → 终极爆发 → 归零重新蓄力（4 段循环）。
  if (enemy.defId === "gremlin_wizard") {
    const cycle = ["charging", "charging", "charging", "ultimate_blast"] as const;
    if (enemy.moveHistory.length === 0) {
      enemy.rotationIndex = 0;
      enemy.currentMove = cycle[0];
      return;
    }
    enemy.rotationIndex = (enemy.rotationIndex + 1) % cycle.length;
    enemy.currentMove = cycle[enemy.rotationIndex]!;
    return;
  }

  // 地精首领：身边存活地精 <2 只则召唤，否则鼓舞 / 突刺（走 weighted）。
  if (enemy.defId === "gremlin_leader") {
    const otherGremlins = combat.enemies.filter(
      e => e.hp > 0 && !e.escaped && e.defId !== "gremlin_leader",
    ).length;
    if (otherGremlins < 2) {
      enemy.currentMove = "summon_gremlins";
      return;
    }
    // 否则落到下方 weighted（鼓舞 / 突刺）。
  }

  // 冠军（第二幕 Boss）：血量首次降到 ≤半血时暴怒一次（+6 力量），其余走 weighted。
  if (
    enemy.defId === "champ" &&
    enemy.hp <= Math.floor(enemy.maxHp / 2) &&
    !enemy.moveHistory.includes("anger")
  ) {
    enemy.currentMove = "anger";
    return;
  }

  // 时间吞噬者（第三幕 Boss）：血量首次降到 <半血时加速一次（回血到半血 + 清自身减益），其余走 weighted。
  if (
    enemy.defId === "time_eater" &&
    enemy.hp * 2 < enemy.maxHp &&
    !enemy.moveHistory.includes("haste")
  ) {
    enemy.currentMove = "haste";
    return;
  }

  // 拾荒者：抢劫×2 → 猛扑或烟雾弹 → 逃跑（偷完金币就跑）。
  if (enemy.defId === "looter") {
    const h = enemy.moveHistory;
    const last = h[h.length - 1];
    if (h.length === 0 || h.length === 1) {
      enemy.currentMove = "mug";
    } else if (last === "mug") {
      enemy.currentMove = nextFloat(state.rng) < 0.5 ? "lunge" : "smoke_bomb";
    } else if (last === "lunge") {
      enemy.currentMove = "smoke_bomb";
    } else {
      enemy.currentMove = "flee";
    }
    return;
  }

  // 红色奴隶主：首招刺击；缠绕整场一次性；其余刮擦 / 刺击（连招上限 2）。
  if (enemy.defId === "red_slaver") {
    const h = enemy.moveHistory;
    if (h.length === 0) {
      enemy.currentMove = "rs_stab";
      return;
    }
    const lastTwoSame = (id: string): boolean =>
      h.length >= 2 && h[h.length - 1] === id && h[h.length - 2] === id;
    const usedEntangle = h.includes("entangle");
    const roll = nextInt(state.rng, 100);
    if (roll >= 75 && !usedEntangle) {
      enemy.currentMove = "entangle";
    } else if (roll >= 50 && usedEntangle && !lastTwoSame("rs_stab")) {
      enemy.currentMove = "rs_stab";
    } else if (!lastTwoSame("scrape")) {
      enemy.currentMove = "scrape";
    } else {
      enemy.currentMove = "rs_stab";
    }
    return;
  }

  // 史莱姆王：黏液喷射 → 蓄力 → 猛砸 固定 3 段循环（半血分裂另由 split 覆盖）。
  if (enemy.defId === "slime_boss") {
    const cycle = ["goop_spray", "preparing", "slam"] as const;
    if (enemy.moveHistory.length === 0) {
      enemy.rotationIndex = 0;
      enemy.currentMove = cycle[0];
      return;
    }
    enemy.rotationIndex = (enemy.rotationIndex + 1) % cycle.length;
    enemy.currentMove = cycle[enemy.rotationIndex]!;
    return;
  }

  // 六火之灵：激活(锁分割伤害) → 分割(6连击) → 固定 7 段仪轨循环。
  if (enemy.defId === "hexaghost") {
    const history = enemy.moveHistory;
    if (history.length === 0) {
      enemy.currentMove = "activate";
      return;
    }
    const last = history[history.length - 1]!;
    if (last === "activate") {
      enemy.currentMove = "divider";
      return;
    }
    if (last === "divider") {
      enemy.rotationIndex = 0;
      enemy.currentMove = HEXAGHOST_RITUAL[0];
      return;
    }
    enemy.rotationIndex = (enemy.rotationIndex + 1) % HEXAGHOST_RITUAL.length;
    enemy.currentMove = HEXAGHOST_RITUAL[enemy.rotationIndex]!;
    return;
  }

  // 哨卫：错位开局（两侧先射钉、中间先光束）+ 光束↔射钉 严格交替。
  if (enemy.defId === "sentry") {
    if (enemy.moveHistory.length === 0) {
      enemy.currentMove = enemyIndex % 2 === 0 ? "bolt" : "beam";
    } else {
      enemy.currentMove =
        enemy.moveHistory[enemy.moveHistory.length - 1] === "beam" ? "bolt" : "beam";
    }
    return;
  }

  // 拉加维林：睡眠 → 苏醒 → 重击/重击/吸取灵魂 循环。
  if (enemy.defId === "lagavulin") {
    if (enemy.asleep) {
      // 睡满（第 3 回合）自然苏醒；否则继续睡。
      if (combat.turn >= LAGAVULIN_WAKE_TURN) {
        enemy.asleep = false;
        removePower(enemy.powers, "metallicize");
        enemy.currentMove = "lag_attack";
      } else {
        enemy.currentMove = "sleep";
      }
      return;
    }
    const history = enemy.moveHistory;
    const lastTwoAttack =
      history.length >= 2 &&
      history[history.length - 1] === "lag_attack" &&
      history[history.length - 2] === "lag_attack";
    enemy.currentMove = lastTwoAttack ? "siphon_soul" : "lag_attack";
    return;
  }

  // 无常：连续重殴，第 5 回合消散离场（逃跑）。
  if (enemy.defId === "transient") {
    enemy.currentMove = enemy.moveHistory.length >= TRANSIENT_FADE_TURN ? "fade" : "transient_slam";
    return;
  }

  // 巨型头颅：前 3 回合凝视蓄势，之后每回合「时候到了」重击。
  if (enemy.defId === "giant_head") {
    enemy.currentMove =
      enemy.moveHistory.length < GIANT_HEAD_GLARE_TURNS ? "gh_glare" : "it_is_time";
    return;
  }

  // Boss：按姿态循环出招。
  if (def.stanceMoves) {
    // 防御三招链走完（rotationIndex 越过防御列表）→ 回进攻姿态：清反甲、从旋风续接，
    // 下一轮进攻再从蓄能开始（复刻 StS 守卫者 Twin Slam 后回到 Whirlwind）。
    if (enemy.stance === "defensive" && enemy.rotationIndex >= def.stanceMoves.defensive.length) {
      enemy.stance = "offensive";
      removePower(enemy.powers, "sharp_hide");
      const whirlwindIdx = def.stanceMoves.offensive.length - 1;
      enemy.currentMove = def.stanceMoves.offensive[whirlwindIdx]!;
      enemy.rotationIndex = whirlwindIdx + 1;
      return;
    }
    const list =
      enemy.stance === "defensive" ? def.stanceMoves.defensive : def.stanceMoves.offensive;
    enemy.currentMove = list[enemy.rotationIndex % list.length]!;
    enemy.rotationIndex += 1;
    return;
  }

  // 脚本开局。
  const scripted = def.intentRule.scripted;
  if (enemy.moveHistory.length < scripted.length) {
    enemy.currentMove = scripted[enemy.moveHistory.length]!;
    return;
  }

  // 加权随机 + 连续限制。
  const eligible = def.intentRule.weighted.filter(entry => {
    let streak = 0;
    for (let k = enemy.moveHistory.length - 1; k >= 0; k -= 1) {
      if (enemy.moveHistory[k] === entry.move) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak < entry.maxInARow;
  });
  const pool = eligible.length > 0 ? eligible : def.intentRule.weighted;
  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = nextFloat(state.rng) * totalWeight;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) {
      enemy.currentMove = entry.move;
      return;
    }
  }
  enemy.currentMove = pool[nextInt(state.rng, pool.length)]!.move;
}

// —— 战斗结算 ——

function resolveCombatIfEnded(state: GameState): void {
  const combat = state.combat!;
  if (livingEnemies(combat).length > 0) {
    return;
  }
  state.log.push("战斗胜利！");
  // 战斗结束遗物（燃烧之血回血 / 带肉骨头低血回血…）在清 combat 前触发。
  triggerRelicCombatEnd(state);
  // 自我修复：战斗结束时回复 = 层数的生命（在清 combat 前读取玩家能力）。
  const selfRepair = getPower(combat.playerPowers, "self_repair");
  if (selfRepair > 0) {
    state.hp = Math.min(state.maxHp, state.hp + selfRepair);
  }
  // 战斗内牌堆（含临时状态牌）随战斗消失，master deck 不受影响。
  state.combat = null;
  if (combat.isBoss) {
    // 击败首领掉金币（~100，对齐 StS）；随后 victory / 进入下一幕由 settleAfterCombat 决定。
    const gold = nextRange(state.rng, BOSS_GOLD_MIN, BOSS_GOLD_MAX);
    state.gold += gold;
    state.log.push(`击败首领，获得 ${gold} 金币。`);
    state.screen = "victory";
  }
  // 非 Boss 的奖励生成在 run 层处理（避免 combat 依赖 run）。
}

export { livingEnemies };
