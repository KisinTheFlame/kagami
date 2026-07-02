import { ALL_CARDS, costOf } from "../engine/cards/cards.js";
import { GLOSSARY, type GlossaryEntry } from "../engine/glossary.js";

// === 参考查询：按 query 匹配卡牌 + 术语，返回结构化数据 ===
//
// 供 agent 侧 lookup 工具消费（GET /reference?q=）。数据是游戏事实，渲染框架文案在 agent .hbs。

export type CardRef = {
  name: string;
  type: string;
  cost: number | null;
  upgradedCost: number | null;
  targeted: boolean;
  description: string;
  upgradedDescription: string;
};

export type ReferenceResult = {
  query: string;
  cards: CardRef[];
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
 * query 为空 → 返回全部术语 + 全部卡；否则子串（不区分大小写）匹配卡名 / 卡 id 与术语名 / 别名。
 */
export function lookupReference(query: string): ReferenceResult {
  const q = query.trim().toLowerCase();

  if (q.length === 0) {
    return {
      query,
      cards: ALL_CARDS.map(card => toCardRef(card.id)),
      terms: [...GLOSSARY],
    };
  }

  const cards = ALL_CARDS.filter(
    card => card.name.toLowerCase().includes(q) || card.id.toLowerCase().includes(q),
  ).map(card => toCardRef(card.id));

  const terms = GLOSSARY.filter(
    entry =>
      entry.term.toLowerCase().includes(q) ||
      entry.aliases.some(alias => alias.toLowerCase().includes(q)),
  );

  return { query, cards, terms };
}
