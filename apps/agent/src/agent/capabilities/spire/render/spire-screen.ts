import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import type {
  SpireEnemyView,
  SpireHandCardView,
  SpirePower,
  SpireReference,
  SpireScreen,
} from "../../../../spire/spire-client.js";

// === ScreenView → 文字屏幕（走 .hbs 模板）===
//
// 渲染放 agent 侧（分工原则，issue #234）：调屏幕文案不用重部署游戏服务。
// TS 只算 view-model（数字 / 数组 / 布尔 flag / 结构标识符）；所有成句文案在
// apps/agent/static/context/spire-screen.hbs（AGENTS.md:92 红线）。
//
// 结构标识符（power / 意图 / 卡类型的短标签，等同 "QQ"/"待办"）留 TS 常量，非语气文案。

const POWER_LABELS: Record<string, string> = {
  strength: "力量",
  dexterity: "敏捷",
  vulnerable: "易伤",
  weak: "虚弱",
  frail: "脆弱",
  metallicize: "金属化",
  ritual: "仪式",
  curl_up: "蜷缩",
  sharp_hide: "反甲",
  enrage: "激怒",
  artifact: "神器",
  angry: "狂怒",
  spore_cloud: "孢子云",
  demon_form: "恶魔形态",
  thorns: "荆棘",
  regen: "再生",
  plated_armor: "镀甲",
  mode_shift: "模式",
};

function labelPowers(powers: readonly SpirePower[]): { label: string; amount: number }[] {
  return powers.map(power => ({ label: POWER_LABELS[power.id] ?? power.id, amount: power.amount }));
}

function enemyView(enemy: SpireEnemyView): Record<string, unknown> {
  const intent = enemy.intent;
  return {
    n: enemy.index + 1,
    name: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    block: enemy.block,
    hasBlock: enemy.block > 0,
    powers: labelPowers(enemy.powers),
    hasPowers: enemy.powers.length > 0,
    isAttack: intent.kind === "attack",
    isDefend: intent.kind === "defend",
    isBuff: intent.kind === "buff",
    isDebuff: intent.kind === "debuff",
    isUnknown: intent.kind === "unknown",
    intentValue: intent.value ?? 0,
    intentHits: intent.hits ?? 1,
    isMultiHit: (intent.hits ?? 1) > 1,
  };
}

function handView(card: SpireHandCardView): Record<string, unknown> {
  return {
    n: card.index + 1,
    name: card.name,
    playable: card.cost !== null,
    cost: card.cost ?? 0,
    targeted: card.targeted,
    description: card.description,
  };
}

export function renderSpireScreen(screen: SpireScreen): string {
  const combat = screen.combat;
  return renderServerStaticTemplate(import.meta.url, "context/spire-screen.hbs", {
    isMap: screen.screen === "map",
    isCombat: screen.screen === "combat",
    isReward: screen.screen === "reward",
    isRest: screen.screen === "rest",
    isEvent: screen.screen === "event",
    eventDescription: screen.event?.description ?? "",
    isShop: screen.screen === "shop",
    isGameover: screen.screen === "gameover",
    isVictory: screen.screen === "victory",
    hp: screen.player.hp,
    maxHp: screen.player.maxHp,
    gold: screen.player.gold,
    deckCount: screen.deckCount,
    relics: screen.relics,
    hasRelics: screen.relics.length > 0,
    potions: screen.potions.map(potion => ({
      slot: potion.slot,
      name: potion.name,
      description: potion.description,
      targeted: potion.targeted,
    })),
    hasPotions: screen.potions.length > 0,
    combat: combat
      ? {
          turn: combat.turn,
          energy: combat.energy,
          maxEnergy: combat.maxEnergy,
          block: combat.block,
          hasBlock: combat.block > 0,
          powers: labelPowers(combat.powers),
          hasPowers: combat.powers.length > 0,
          enemies: combat.enemies.map(enemyView),
          hand: combat.hand.map(handView),
          draw: combat.piles.draw,
          discard: combat.piles.discard,
          exhaust: combat.piles.exhaust,
        }
      : null,
    options: screen.options.map((text, index) => ({ n: index, text })),
    hasOptions: screen.options.length > 0,
  });
}

/** 没有进行中对局时的提示屏（look 拿到 null 时用）。 */
export function renderSpireNoRun(): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-no-run.hbs", {});
}

/** 进入尖塔 App 的定位屏（onFocus 用，无网络 I/O）；子工具清单归 spire-app-help.hbs。 */
export function renderSpirePortal(): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-portal.hbs", {});
}

const CARD_TYPE_LABELS: Record<string, string> = {
  attack: "攻击",
  skill: "技能",
  power: "能力",
  status: "状态牌",
};

/** lookup 结果 → 文字（卡牌信息 + 术语定义）。框架文案在 .hbs，游戏数据插值。 */
export function renderSpireReference(ref: SpireReference): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-reference.hbs", {
    query: ref.query,
    hasQuery: ref.query.trim().length > 0,
    hasResults: ref.cards.length > 0 || ref.terms.length > 0,
    hasCards: ref.cards.length > 0,
    hasTerms: ref.terms.length > 0,
    cards: ref.cards.map(card => ({
      name: card.name,
      typeLabel: CARD_TYPE_LABELS[card.type] ?? card.type,
      playable: card.cost !== null,
      cost: card.cost ?? 0,
      upgradedCost: card.upgradedCost ?? 0,
      costChanges: card.cost !== card.upgradedCost,
      targeted: card.targeted,
      description: card.description,
      upgradedDescription: card.upgradedDescription,
    })),
    terms: ref.terms,
  });
}
