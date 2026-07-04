import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import type {
  SpireEnemyView,
  SpireHandCardView,
  SpirePower,
  SpireReference,
  SpireScreen,
} from "../../../../acl/spire-client.js";

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
  entangled: "缠绕",
  poison: "中毒",
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
  combust: "燃烧",
  feel_no_pain: "无痛",
  dark_embrace: "暗黑拥抱",
  juggernaut: "主宰",
  brutality: "残暴",
  barricade: "壁垒",
  rupture: "破裂",
  thousand_cuts: "千刃",
  after_image: "残影",
  noxious_fumes: "毒雾",
  devotion: "虔诚",
  mental_fortress: "心之堡垒",
  rushdown: "疾攻",
  storm: "风暴",
  heatsinks: "散热",
  static_discharge: "静电放电",
  machine_learning: "机器学习",
  evolve: "进化",
  corruption: "腐化",
  nirvana: "涅槃",
  infinite_blades: "无尽之刃",
  intangible: "虚无缥缈",
  blur: "疾影",
  biased_cognition: "偏置认知",
  buffer: "缓冲",
  battle_hymn: "战歌",
  strength_temp: "临时力量",
  rage: "暴怒",
  double_tap: "连击",
  berserk: "狂暴",
};

const ORB_LABELS: Record<string, string> = {
  lightning: "闪电",
  frost: "冰霜",
  dark: "暗",
  plasma: "等离子",
};

const STANCE_LABELS: Record<string, string> = {
  none: "无",
  calm: "平静",
  wrath: "愤怒",
  divinity: "神性",
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
    act: screen.act,
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
          hasOrbSystem: combat.orbSlots > 0,
          orbs: combat.orbs.map(type => ORB_LABELS[type] ?? type),
          orbSlots: combat.orbSlots,
          hasStance: combat.stance !== "none",
          stance: STANCE_LABELS[combat.stance] ?? combat.stance,
          hasMantra: combat.mantra > 0,
          mantra: combat.mantra,
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
  curse: "诅咒",
};

const SPIRE_RARITY_LABELS: Record<string, string> = {
  starter: "起始",
  common: "普通",
  uncommon: "罕见",
  rare: "稀有",
  boss: "首领",
  special: "特殊",
};

/** lookup 结果 → 文字（卡牌信息 + 术语定义）。框架文案在 .hbs，游戏数据插值。 */
export function renderSpireReference(ref: SpireReference): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-reference.hbs", {
    query: ref.query,
    hasQuery: ref.query.trim().length > 0,
    hasResults:
      ref.cards.length > 0 ||
      ref.relics.length > 0 ||
      ref.potions.length > 0 ||
      ref.terms.length > 0,
    hasCards: ref.cards.length > 0,
    hasRelics: ref.relics.length > 0,
    hasPotions: ref.potions.length > 0,
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
    relics: ref.relics.map(relic => ({
      name: relic.name,
      rarityLabel: SPIRE_RARITY_LABELS[relic.rarity] ?? relic.rarity,
      description: relic.description,
    })),
    potions: ref.potions.map(potion => ({
      name: potion.name,
      rarityLabel: SPIRE_RARITY_LABELS[potion.rarity] ?? potion.rarity,
      targeted: potion.targeted,
      description: potion.description,
    })),
    terms: ref.terms,
  });
}
