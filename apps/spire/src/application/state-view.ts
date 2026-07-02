import type { EnemyState, GameState, PowerInstance } from "../engine/types.js";
import { costOf, getCardDef } from "../engine/cards/cards.js";
import { getEnemyDef } from "../engine/enemies/enemies.js";
import { computeAttackDamage } from "../engine/powers/powers.js";
import { getRelicDef } from "../engine/relics/relics.js";
import { getPotionDef } from "../engine/potions/potions.js";
import { currentOptions } from "../engine/run/run.js";

// === 结构化屏幕视图（ScreenView）===
//
// 服务返回这个纯 JSON，agent 侧 render/screen.ts 据此渲染文字屏幕（分工原则，issue #234）。
// 意图展示数值在此按当前状态重算（玩家看到的是含力量/虚弱/易伤修正后的实际伤害）。

export type IntentView = {
  kind: "attack" | "defend" | "buff" | "debuff" | "unknown";
  value?: number;
  hits?: number;
};

export type EnemyView = {
  index: number;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  powers: PowerInstance[];
  intent: IntentView;
};

export type HandCardView = {
  index: number;
  name: string;
  cost: number | null;
  type: string;
  targeted: boolean;
  description: string;
};

export type CombatView = {
  turn: number;
  energy: number;
  maxEnergy: number;
  block: number;
  powers: PowerInstance[];
  enemies: EnemyView[];
  hand: HandCardView[];
  piles: { draw: number; discard: number; exhaust: number };
};

export type RelicView = { name: string; description: string };
export type PotionView = { slot: number; name: string; description: string; targeted: boolean };

export type ScreenView = {
  version: number;
  screen: GameState["screen"];
  player: { hp: number; maxHp: number; gold: number };
  deckCount: number;
  relics: RelicView[];
  potions: PotionView[];
  combat: CombatView | null;
  options: string[];
  log: string[];
};

export function toScreenView(state: GameState, opts: { suppressLog?: boolean }): ScreenView {
  return {
    version: state.version,
    screen: state.screen,
    player: { hp: state.hp, maxHp: state.maxHp, gold: state.gold },
    deckCount: state.deck.length,
    relics: state.relics.map(relic => {
      const def = getRelicDef(relic.id);
      return { name: def.name, description: def.description };
    }),
    potions: state.potions.flatMap((id, slot) => {
      if (id === null) {
        return [];
      }
      const def = getPotionDef(id);
      return [{ slot, name: def.name, description: def.description, targeted: def.targeted }];
    }),
    combat: state.combat ? toCombatView(state) : null,
    options: currentOptions(state),
    log: opts.suppressLog ? [] : state.log,
  };
}

function toCombatView(state: GameState): CombatView {
  const combat = state.combat!;
  return {
    turn: combat.turn,
    energy: combat.energy,
    maxEnergy: combat.maxEnergy,
    block: combat.playerBlock,
    powers: combat.playerPowers,
    enemies: combat.enemies
      .map((enemy, index) => ({ enemy, index }))
      .filter(entry => entry.enemy.hp > 0)
      .map(entry => toEnemyView(state, entry.enemy, entry.index)),
    hand: combat.hand.map((instance, index) => {
      const def = getCardDef(instance.defId);
      return {
        index,
        name: def.name + (instance.upgraded ? "+" : ""),
        cost: costOf(def, instance.upgraded),
        type: def.type,
        targeted: def.targeted,
        description: instance.upgraded ? def.upgradedDescription : def.description,
      };
    }),
    piles: {
      draw: combat.drawPile.length,
      discard: combat.discardPile.length,
      exhaust: combat.exhaustPile.length,
    },
  };
}

function toEnemyView(state: GameState, enemy: EnemyState, index: number): EnemyView {
  return {
    index,
    name: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    block: enemy.block,
    powers: enemy.powers,
    intent: computeIntent(state, enemy),
  };
}

function computeIntent(state: GameState, enemy: EnemyState): IntentView {
  const def = getEnemyDef(enemy.defId);
  const move = def.moves.find(candidate => candidate.id === enemy.currentMove);
  if (!move) {
    return { kind: "unknown" };
  }
  const playerPowers = state.combat!.playerPowers;
  for (const effect of move.effects) {
    if (effect.kind === "deal_damage") {
      return {
        kind: "attack",
        value: computeAttackDamage(effect.amount, enemy.powers, playerPowers),
        hits: 1,
      };
    }
    if (effect.kind === "deal_damage_multi") {
      return {
        kind: "attack",
        value: computeAttackDamage(effect.amount, enemy.powers, playerPowers),
        hits: effect.times,
      };
    }
    if (effect.kind === "deal_damage_rolled") {
      // 红虱咬击 / 六火之灵分割：基础值是锁定的固定值，可多段。
      return {
        kind: "attack",
        value: computeAttackDamage(enemy.rolledDamage, enemy.powers, playerPowers),
        hits: effect.times ?? 1,
      };
    }
  }
  // 无攻击：按意图分类给玩家看。
  return { kind: move.intent };
}
