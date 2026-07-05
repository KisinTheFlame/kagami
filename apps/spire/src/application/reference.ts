import { ALL_CARDS, costOf } from "../engine/cards/cards.js";
import { ALL_RELICS } from "../engine/relics/relics.js";
import { ALL_POTIONS } from "../engine/potions/potions.js";
import { GLOSSARY, type GlossaryEntry } from "../engine/glossary.js";

// === 参考查询：按 query 匹配卡牌 / 遗物 / 药水 / 术语，返回结构化数据 ===
//
// 供 agent 侧 lookup 工具消费（GET /reference?q=）。数据是游戏事实，渲染框架文案在 agent .hbs。

type CardRef = {
  name: string;
  type: string;
  cost: number | null;
  upgradedCost: number | null;
  targeted: boolean;
  description: string;
  upgradedDescription: string;
};

type RelicRef = {
  name: string;
  rarity: string;
  description: string;
};

type PotionRef = {
  name: string;
  rarity: string;
  targeted: boolean;
  description: string;
};

export type ReferenceResult = {
  query: string;
  cards: CardRef[];
  relics: RelicRef[];
  potions: PotionRef[];
  terms: GlossaryEntry[];
};

function toCardRef(cardId: string): CardRef {
  const def = ALL_CARDS.find(card => card.id === cardId)!;
  return {
    name: def.name,
    type: def.type,
    cost: costOf(def, false),
    upgradedCost: costOf(def, true),
    targeted: def.targeted,
    description: def.description,
    upgradedDescription: def.upgradedDescription,
  };
}

/**
 * query 为空 → 返回全部卡 / 遗物 / 药水 / 术语；否则子串（不区分大小写）匹配名 / id / 术语别名。
 */
export function lookupReference(query: string): ReferenceResult {
  const q = query.trim().toLowerCase();
  const matches = (name: string, id: string): boolean =>
    q.length === 0 || name.toLowerCase().includes(q) || id.toLowerCase().includes(q);

  const cards = ALL_CARDS.filter(card => matches(card.name, card.id)).map(card =>
    toCardRef(card.id),
  );

  const relics = ALL_RELICS.filter(relic => matches(relic.name, relic.id)).map(relic => ({
    name: relic.name,
    rarity: relic.rarity,
    description: relic.description,
  }));

  const potions = ALL_POTIONS.filter(potion => matches(potion.name, potion.id)).map(potion => ({
    name: potion.name,
    rarity: potion.rarity,
    targeted: potion.targeted,
    description: potion.description,
  }));

  const terms = GLOSSARY.filter(
    entry =>
      q.length === 0 ||
      entry.term.toLowerCase().includes(q) ||
      entry.aliases.some(alias => alias.toLowerCase().includes(q)),
  );

  return { query, cards, relics, potions, terms };
}
