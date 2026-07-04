import type {
  CardInstance,
  CardType,
  CombatState,
  Effect,
  EnemyState,
  GameState,
  OrbType,
  PlayerStance,
  PowerInstance,
  RelicState,
} from "../types.js";
import { getCardDef, costOf, effectsOf } from "../cards/cards.js";
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
const BOSS_GOLD_MIN = 95; // 击败首领掉金币区间（对齐 StS）。
const BOSS_GOLD_MAX = 105;
const AWAKENED_REVIVE_STRENGTH = 3; // 觉醒者复活时获得的力量。
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
    encounterId,
    isBoss: encounter.isBoss,
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
  // 蛇之戒指（静默起始遗物）：战斗第一回合额外抽 2 张。
  const firstTurnDraw = hasRelic(state, "ring_of_the_snake") ? 2 : 0;
  drawCards(state, STARTING_HAND_SIZE + firstTurnDraw);
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
function triggerPlayerCardPlayed(state: GameState): void {
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
}

// —— 抽牌 ——

function drawCards(state: GameState, count: number): void {
  const combat = state.combat!;
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
    if (combat.hand.length >= MAX_HAND_SIZE) {
      combat.discardPile.push(card); // 手牌满：抽到的牌直接进弃牌堆。
    } else {
      combat.hand.push(card);
    }
  }
}

// —— 效果解释器 ——

function applyEffects(
  state: GameState,
  effects: readonly Effect[],
  actor: ActorRef,
  targetEnemyIndex: number | null,
): void {
  for (const effect of effects) {
    applyEffect(state, effect, actor, targetEnemyIndex);
  }
}

function applyEffect(
  state: GameState,
  effect: Effect,
  actor: ActorRef,
  targetEnemyIndex: number | null,
): void {
  const combat = state.combat!;
  const powers = actorPowers(state, actor);

  switch (effect.kind) {
    case "deal_damage": {
      if (actor.side === "player") {
        if (targetEnemyIndex !== null) {
          dealDamageToEnemy(
            state,
            targetEnemyIndex,
            effect.amount,
            powers,
            effect.strengthMultiplier,
          );
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
            dealDamageToEnemy(state, targetEnemyIndex, effect.amount, powers);
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
      if (actor.side === "player") {
        combat.playerBlock += gained;
        // 主宰：每当玩家获得格挡，对随机敌人造成 = 层数的伤害。
        const juggernaut = getPower(combat.playerPowers, "juggernaut");
        if (juggernaut > 0) {
          dealOrbDamage(state, juggernaut);
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
        combat.energy += effect.amount;
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
  for (let i = 0; i < count; i += 1) {
    const instance: CardInstance = { uid: state.nextUid++, defId: cardId, upgraded: false };
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

function dealDamageToEnemy(
  state: GameState,
  enemyIndex: number,
  base: number,
  attackerPowers: readonly PowerInstance[],
  strengthMultiplier = 1,
): void {
  const enemy = state.combat!.enemies[enemyIndex]!;
  if (enemy.hp <= 0) {
    return;
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
  // 愤怒姿态（观者）：玩家造成的伤害翻倍。
  if (state.combat!.playerStance === "wrath") {
    dmg *= 2;
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
  const afterBlock = Math.max(0, dmg - combat.playerBlock);
  combat.playerBlock = Math.max(0, combat.playerBlock - dmg);
  state.hp = Math.max(0, state.hp - afterBlock);
  // 镀甲：受到穿透格挡的攻击伤害时 -1 层。
  if (afterBlock > 0 && getPower(combat.playerPowers, "plated_armor") > 0) {
    addPower(combat.playerPowers, "plated_armor", -1);
  }
  // 荆棘：每次被攻击对攻击者反弹固定伤害（无视其格挡，直接掉血）。
  const thorns = getPower(combat.playerPowers, "thorns");
  if (thorns > 0 && attackerIndex !== undefined) {
    const attacker = combat.enemies[attackerIndex];
    if (attacker && attacker.hp > 0) {
      attacker.hp = Math.max(0, attacker.hp - thorns);
    }
  }
}

// —— 姿态（观者）——

const CALM_EXIT_ENERGY = 2; // 离开平静姿态回复的能量。

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
  const pick = living[nextInt(state.rng, living.length)]!.index;
  dealDamageToEnemy(state, pick, amount, []);
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
  combat.orbs.push({ type });
}

/** 唤醒指定槽位的球：触发唤醒效果后移除。 */
function evokeOrb(state: GameState, index: number): void {
  const combat = state.combat!;
  const orb = combat.orbs[index];
  if (!orb) {
    return;
  }
  const focus = getPower(combat.playerPowers, "focus");
  if (orb.type === "lightning") {
    dealOrbDamage(state, LIGHTNING_EVOKE + focus);
  } else {
    combat.playerBlock += Math.max(0, FROST_EVOKE + focus);
  }
  combat.orbs.splice(index, 1);
}

/** 回合结束时所有球触发被动（闪电随机伤害 / 冰霜格挡）。 */
function triggerOrbPassives(state: GameState): void {
  const combat = state.combat!;
  const focus = getPower(combat.playerPowers, "focus");
  for (const orb of combat.orbs) {
    if (orb.type === "lightning") {
      dealOrbDamage(state, LIGHTNING_PASSIVE + focus);
    } else {
      combat.playerBlock += Math.max(0, FROST_PASSIVE + focus);
    }
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
  const cost = costOf(def, instance.upgraded);
  if (cost === null) {
    return { ok: false, reason: `「${def.name}」无法打出。` };
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

  combat.energy -= cost;
  combat.hand.splice(handIndex, 1);
  applyEffects(state, effectsOf(def, instance.upgraded), { side: "player" }, resolvedTarget);
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
  } else if (def.exhausts) {
    exhaustCard(state, instance);
  } else {
    combat.discardPile.push(instance);
  }
  state.log.push(`你打出「${def.name}」。`);
  // 出牌计数遗物（手里剑/苦无/装饰扇按攻击计数、鸟面瓮按能力回血…）。
  triggerRelicCardPlayed(state, def.type);
  // 打牌触发型玩家能力（千刃对全体、残影加格挡）。
  triggerPlayerCardPlayed(state);

  resolveCombatIfEnded(state);
  // 反甲反噬等可能在自己回合内把玩家打死：战斗未结束但玩家已倒下 → 判负。
  if (state.combat !== null && state.hp <= 0) {
    state.screen = "gameover";
    state.log.push("你倒下了。");
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
  if (state.hp <= 0) {
    state.screen = "gameover";
    state.log.push("你倒下了。");
    return;
  }
  // 玩家回合结束：保留牌留在手中，虚无牌被消耗，其余进弃牌堆；玩家 debuff 衰减。
  const retained: CardInstance[] = [];
  for (const instance of combat.hand) {
    const cardDef = getCardDef(instance.defId);
    if (cardDef.retain) {
      retained.push(instance);
    } else if (cardDef.ethereal) {
      combat.exhaustPile.push(instance);
    } else {
      combat.discardPile.push(instance);
    }
  }
  combat.hand = retained;
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
  // 充能球被动（机器人）：回合结束时每颗球触发（闪电随机伤害 / 冰霜格挡）。
  triggerOrbPassives(state);
  // 回合结束遗物（山铜：若无格挡则补格挡）——在金属化之后判定。
  triggerRelicTurnEnd(state);
  decayDebuffs(combat.playerPowers);

  // 敌人回合。用回合开始时的敌人数封顶，分裂新生的敌人本回合不行动。
  const enemyCount = combat.enemies.length;
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
  // 壁垒：格挡不再于回合开始清空（否则清零）。
  if (getPower(combat.playerPowers, "barricade") === 0) {
    combat.playerBlock = 0;
  }
  combat.energy = combat.maxEnergy;
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
  // 回合开始遗物（欢乐花能量 / 角锚第二回合格挡 / 水银沙漏回合始发伤）。
  triggerRelicTurnStart(state);
  // 回合始遗物可能（如水银沙漏 AoE）打死全部残敌 → 结算胜利，不再发牌。
  resolveCombatIfEnded(state);
  if (state.combat === null || state.screen !== "combat") {
    return;
  }
  drawCards(state, STARTING_HAND_SIZE);
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
