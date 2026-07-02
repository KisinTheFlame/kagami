import type { GameState } from "../engine/types.js";
import type { GameAction } from "../engine/engine.js";
import { costOf, getCardDef } from "../engine/cards/cards.js";
import { nextInt } from "../engine/rng.js";
import { availableNext } from "../engine/map/map.js";
import type { RngState } from "../engine/types.js";

// === 自动对战策略 ===
//
// 纯引擎层：只读 GameState、产出合法 GameAction。用于平衡验证（跑几千局看胜率/回合数）
// 与黄金种子回归（确定性）。策略自带 RNG（与游戏 RNG 分离，不污染对局种子）。

/** 枚举当前态下的合法动作。 */
export function legalActions(state: GameState): GameAction[] {
  if (state.screen === "combat" && state.combat) {
    const combat = state.combat;
    const target = lowestHpEnemyIndex(state);
    const actions: GameAction[] = [];
    combat.hand.forEach((instance, handIndex) => {
      const def = getCardDef(instance.defId);
      const cost = costOf(def, instance.upgraded);
      if (cost !== null && cost <= combat.energy) {
        actions.push({
          type: "play_card",
          handIndex,
          targetIndex: def.targeted ? target : null,
        });
      }
    });
    actions.push({ type: "end_turn" });
    return actions;
  }
  if (state.screen === "map") {
    const count = availableNext(state.map, state.currentNodeId).length;
    return Array.from({ length: Math.max(1, count) }, (_, optionIndex) => ({
      type: "choose" as const,
      optionIndex,
    }));
  }
  if (state.screen === "reward" || state.screen === "rest") {
    // 选项数量 = currentOptions().length；这里不引 run 层，直接按已知结构估算上界后再交给引擎校验。
    // reward: cardChoices + 跳过；rest: 1(休息) + 可升级卡数。用一个安全上界枚举，引擎会拒绝越界。
    const count =
      state.screen === "reward"
        ? (state.reward?.cardChoices.length ?? 0) + 1
        : 1 + state.deck.filter(card => !card.upgraded).length;
    return Array.from({ length: Math.max(1, count) }, (_, optionIndex) => ({
      type: "choose" as const,
      optionIndex,
    }));
  }
  return [];
}

export interface Policy {
  decide(state: GameState): GameAction;
}

export class RandomPolicy implements Policy {
  private readonly rng: RngState;
  public constructor(rng: RngState) {
    this.rng = rng;
  }
  public decide(state: GameState): GameAction {
    const actions = legalActions(state);
    return actions[nextInt(this.rng, actions.length)] ?? { type: "end_turn" };
  }
}

/** 贪心：能打的攻击往最低血敌人砸、否则出防御，最后 end_turn；非战斗屏永远选第一项。 */
export class GreedyPolicy implements Policy {
  public decide(state: GameState): GameAction {
    if (state.screen !== "combat" || !state.combat) {
      return { type: "choose", optionIndex: 0 };
    }
    const combat = state.combat;
    const target = lowestHpEnemyIndex(state);
    // 先出攻击牌，再出加格挡牌，够费就打。
    const order = ["attack", "skill"];
    for (const wantType of order) {
      for (let handIndex = 0; handIndex < combat.hand.length; handIndex += 1) {
        const def = getCardDef(combat.hand[handIndex]!.defId);
        const cost = costOf(def, combat.hand[handIndex]!.upgraded);
        if (def.type === wantType && cost !== null && cost <= combat.energy) {
          return { type: "play_card", handIndex, targetIndex: def.targeted ? target : null };
        }
      }
    }
    return { type: "end_turn" };
  }
}

function lowestHpEnemyIndex(state: GameState): number {
  const enemies = state.combat?.enemies ?? [];
  let best = -1;
  let bestHp = Infinity;
  enemies.forEach((enemy, index) => {
    if (enemy.hp > 0 && enemy.hp < bestHp) {
      bestHp = enemy.hp;
      best = index;
    }
  });
  return best < 0 ? 0 : best;
}
