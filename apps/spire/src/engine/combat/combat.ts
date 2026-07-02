import type {
  CardInstance,
  CombatState,
  Effect,
  EnemyState,
  GameState,
  PowerInstance,
} from "../types.js";
import { getCardDef, costOf, effectsOf } from "../cards/cards.js";
import { getEnemyDef, getEncounterDef } from "../enemies/enemies.js";
import { nextRange, nextFloat, nextInt, shuffleInPlace } from "../rng.js";
import {
  addPower,
  applyFrailToBlock,
  computeAttackDamage,
  decayDebuffs,
  getPower,
  removePower,
} from "../powers/powers.js";
import { getRelicDef } from "../relics/relics.js";

// === 战斗状态机 ===
//
// 所有函数原地改 GameState（含 state.combat）。玩家血在 state.hp/maxHp，
// 玩家格挡/powers 在 combat.playerBlock/playerPowers。敌人各自持有 hp/block/powers。

const STARTING_ENERGY = 3;
const STARTING_HAND_SIZE = 5;
const MAX_HAND_SIZE = 10;
const GUARDIAN_MODE_SHIFT_STEP = 10;
const GUARDIAN_SHIFT_BLOCK = 20;
const LOUSE_CURL_UP_MIN = 3;
const LOUSE_CURL_UP_MAX = 7;
const LOUSE_BITE_MIN = 5;
const LOUSE_BITE_MAX = 7;

type ActorRef = { side: "player" } | { side: "enemy"; index: number };

function livingEnemies(combat: CombatState): EnemyState[] {
  return combat.enemies.filter(enemy => enemy.hp > 0);
}

function actorPowers(state: GameState, actor: ActorRef): PowerInstance[] {
  const combat = state.combat!;
  return actor.side === "player" ? combat.playerPowers : combat.enemies[actor.index]!.powers;
}

// —— 开局 ——

export function startCombat(state: GameState, encounterId: string): void {
  const encounter = getEncounterDef(encounterId);
  const enemies: EnemyState[] = encounter.enemies.map(defId => {
    const def = getEnemyDef(defId);
    const powers: PowerInstance[] = [];
    let rolledDamage = 0;
    if (defId === "louse") {
      // 红虱开局自带蜷缩（首次被攻击获得格挡），block 值随机。
      const curl = nextRange(state.rng, LOUSE_CURL_UP_MIN, LOUSE_CURL_UP_MAX);
      powers.push({ id: "curl_up", amount: curl });
      // 咬击基础伤害出生时掷一次、整场固定（5~7）。
      rolledDamage = nextRange(state.rng, LOUSE_BITE_MIN, LOUSE_BITE_MAX);
    }
    const hp = nextRange(state.rng, def.hpMin, def.hpMax);
    return {
      defId,
      name: def.name,
      hp,
      maxHp: hp,
      block: 0,
      powers,
      moveHistory: [],
      rotationIndex: 0,
      currentMove: "",
      curlUpConsumed: false,
      rolledDamage,
      modeShiftAccum: 0,
      modeShiftThreshold: def.modeShiftThreshold ?? null,
      stance: def.stanceMoves ? "offensive" : null,
    } satisfies EnemyState;
  });

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
  triggerRelics(state, "onCombatStart");
  drawCards(state, STARTING_HAND_SIZE);
}

/** 遍历持有遗物、触发指定时点的钩子（原地改 state）。 */
function triggerRelics(state: GameState, event: "onCombatStart" | "onCombatEnd"): void {
  for (const relic of state.relics) {
    getRelicDef(relic.id).hooks[event]?.(state);
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
        dealDamageToPlayer(state, effect.amount, powers);
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
      // 敌人专用：用出生时掷定、整场固定的基础值攻击玩家（红虱咬击）。
      if (actor.side === "enemy") {
        dealDamageToPlayer(state, combat.enemies[actor.index]!.rolledDamage, powers);
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
          dealDamageToPlayer(state, effect.amount, powers);
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
      // 脆弱使获得的格挡打七五折（按「获得方」自己的 powers 判定）。
      const gained = applyFrailToBlock(effect.amount, powers);
      if (actor.side === "player") {
        combat.playerBlock += gained;
      } else {
        combat.enemies[actor.index]!.block += gained;
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
        addPower(enemy.powers, power, amount);
      }
    }
    return;
  }
  // on === "target"
  if (actor.side === "player") {
    if (targetEnemyIndex !== null) {
      addPower(combat.enemies[targetEnemyIndex]!.powers, power, amount);
    }
  } else {
    addPower(combat.playerPowers, power, amount);
  }
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
  const dmg = computeAttackDamage(base, attackerPowers, enemy.powers, strengthMultiplier);
  // 守卫者模式切换：进攻姿态下累计受到的伤害达阈值即切姿态（issue #234 C10）。
  if (enemy.stance === "offensive" && enemy.modeShiftThreshold !== null) {
    enemy.modeShiftAccum += dmg;
  }
  const afterBlock = Math.max(0, dmg - enemy.block);
  enemy.block = Math.max(0, enemy.block - dmg);
  enemy.hp = Math.max(0, enemy.hp - afterBlock);
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
): void {
  const combat = state.combat!;
  const dmg = computeAttackDamage(base, attackerPowers, combat.playerPowers);
  const afterBlock = Math.max(0, dmg - combat.playerBlock);
  combat.playerBlock = Math.max(0, combat.playerBlock - dmg);
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
  if (def.type === "power") {
    // 能力牌打出后离场（效果转为常驻 power），不入任何牌堆，本场不再抽到。
  } else if (def.exhausts) {
    combat.exhaustPile.push(instance);
  } else {
    combat.discardPile.push(instance);
  }
  state.log.push(`你打出「${def.name}」。`);

  resolveCombatIfEnded(state);
  // 反甲反噬等可能在自己回合内把玩家打死：战斗未结束但玩家已倒下 → 判负。
  if (state.combat !== null && state.hp <= 0) {
    state.screen = "gameover";
    state.log.push("你倒下了。");
  }
  return { ok: true };
}

// —— 结束回合 / 敌人行动 ——

export function endTurn(state: GameState): void {
  const combat = state.combat;
  if (!combat || state.screen !== "combat") {
    return;
  }
  // 玩家回合结束：手牌进弃牌堆，玩家 debuff 衰减。
  combat.discardPile.push(...combat.hand);
  combat.hand = [];
  decayDebuffs(combat.playerPowers);

  // 敌人回合。
  for (let i = 0; i < combat.enemies.length; i += 1) {
    const enemy = combat.enemies[i]!;
    if (enemy.hp <= 0) {
      continue;
    }
    enemy.block = 0; // 敌人回合开始清格挡。
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
    decayDebuffs(enemy.powers);
    // 下一招 telegraph（守卫者的姿态推进与防御→进攻切换在 selectNextMove 内处理）。
    selectNextMove(state, i);
  }

  // 下个玩家回合开始。
  combat.turn += 1;
  combat.playerBlock = 0;
  combat.energy = combat.maxEnergy;
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
  const enemy = state.combat!.enemies[enemyIndex]!;
  if (enemy.hp <= 0) {
    return;
  }
  const def = getEnemyDef(enemy.defId);

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
  // 战斗结束遗物（燃烧之血回血…）在清 combat 前触发。
  triggerRelics(state, "onCombatEnd");
  // 战斗内牌堆（含临时状态牌）随战斗消失，master deck 不受影响。
  state.combat = null;
  if (combat.isBoss) {
    state.screen = "victory";
  }
  // 非 Boss 的奖励生成在 run 层处理（避免 combat 依赖 run）。
}

export { livingEnemies };
