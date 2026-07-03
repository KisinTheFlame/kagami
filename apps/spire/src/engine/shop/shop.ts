import type { GameState, ShopItem, ShopState } from "../types.js";
import { rewardCardPoolOf } from "../cards/cards.js";
import { getCharacterConfig } from "../characters/characters.js";
import { shopRelicPool, hasRelic } from "../relics/relics.js";
import { POTION_DROP_POOL } from "../potions/potions.js";
import { nextInt, nextRange } from "../rng.js";

// === 商店库存生成 ===
//
// 进店时一次性生成库存并定价（此后价格固定）。定价区间近似 StS（功能性数值）：
// 卡 ~45-65、遗物 ~140-180、药水 ~50-70。稀有度分档待卡池/遗物全量里程碑细化。

const SHOP_CARD_COUNT = 5;
const SHOP_RELIC_COUNT = 2;
const SHOP_POTION_COUNT = 3;

const CARD_PRICE_MIN = 45;
const CARD_PRICE_MAX = 65;
const RELIC_PRICE_MIN = 140;
const RELIC_PRICE_MAX = 180;
const POTION_PRICE_MIN = 50;
const POTION_PRICE_MAX = 70;
const PURGE_COST = 75;

/** 从池里不重复抽 count 个 id。 */
function sampleUnique(rng: GameState["rng"], pool: readonly string[], count: number): string[] {
  const remaining = [...pool];
  const out: string[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    out.push(remaining.splice(nextInt(rng, remaining.length), 1)[0]!);
  }
  return out;
}

/** 生成一间商店的库存（原地写入 state.shop，切到 shop 屏）。 */
export function generateShop(state: GameState): void {
  const items: ShopItem[] = [];

  const cardPool = rewardCardPoolOf(getCharacterConfig(state.character).color);
  for (const defId of sampleUnique(state.rng, cardPool, SHOP_CARD_COUNT)) {
    items.push({
      kind: "card",
      defId,
      cost: nextRange(state.rng, CARD_PRICE_MIN, CARD_PRICE_MAX),
      sold: false,
    });
  }

  const relicPool = shopRelicPool(state.character).filter(id => !hasRelic(state, id));
  for (const id of sampleUnique(state.rng, relicPool, SHOP_RELIC_COUNT)) {
    items.push({
      kind: "relic",
      id,
      cost: nextRange(state.rng, RELIC_PRICE_MIN, RELIC_PRICE_MAX),
      sold: false,
    });
  }

  for (const id of sampleUnique(state.rng, POTION_DROP_POOL, SHOP_POTION_COUNT)) {
    items.push({
      kind: "potion",
      id,
      cost: nextRange(state.rng, POTION_PRICE_MIN, POTION_PRICE_MAX),
      sold: false,
    });
  }

  state.shop = {
    items,
    purgeCost: PURGE_COST,
    purgeUsed: false,
    removing: false,
  } satisfies ShopState;
  state.screen = "shop";
}
