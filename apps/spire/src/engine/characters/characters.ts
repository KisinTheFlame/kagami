import type { CardColor, CharacterId } from "../types.js";
import {
  DEFECT_STARTER_DECK,
  IRONCLAD_STARTER_DECK,
  SILENT_STARTER_DECK,
  WATCHER_STARTER_DECK,
} from "../cards/cards.js";
import { IRONCLAD_STARTER_RELIC } from "../relics/relics.js";

// === 角色配置 ===
//
// 每个角色的起始参数（血量 / 起始牌组 / 起始遗物 / 卡池颜色）集中在这张表。
// newRun 据此初始化；奖励卡池按角色颜色过滤。新增角色 = 往这里加一行 + 填对应颜色的卡。

export type CharacterConfig = {
  id: CharacterId;
  name: string;
  maxHp: number;
  starterRelic: string;
  starterDeck: readonly string[];
  /** 该角色的卡牌颜色（决定奖励 / 商店抽哪一池卡）。 */
  color: CardColor;
};

const CHARACTERS: Partial<Record<CharacterId, CharacterConfig>> = {
  ironclad: {
    id: "ironclad",
    name: "铁甲战士",
    maxHp: 80,
    starterRelic: IRONCLAD_STARTER_RELIC,
    starterDeck: IRONCLAD_STARTER_DECK,
    color: "red",
  },
  silent: {
    id: "silent",
    name: "静默猎手",
    maxHp: 70,
    starterRelic: "ring_of_the_snake",
    starterDeck: SILENT_STARTER_DECK,
    color: "green",
  },
  defect: {
    id: "defect",
    name: "故障机器人",
    maxHp: 75,
    starterRelic: "cracked_core",
    starterDeck: DEFECT_STARTER_DECK,
    color: "blue",
  },
  watcher: {
    id: "watcher",
    name: "静心观者",
    maxHp: 72,
    starterRelic: "pure_water",
    starterDeck: WATCHER_STARTER_DECK,
    color: "purple",
  },
};

export function getCharacterConfig(id: CharacterId): CharacterConfig {
  const config = CHARACTERS[id];
  if (!config) {
    throw new Error(`未实现的角色: ${id}`);
  }
  return config;
}

export const ALL_CHARACTERS: readonly CharacterConfig[] = Object.values(CHARACTERS).filter(
  (c): c is CharacterConfig => c !== undefined,
);
