import type { GameState } from "../types.js";
import { addPower } from "../powers/powers.js";

// === 遗物系统 ===
//
// 遗物是持久战力：在战斗流程的固定时点触发效果（复刻杀戮尖塔的 atBattleStart / onVictory 等）。
// state.relics 只存可序列化的 { id, counter }；遗物「行为」在这张表里按 id 查（钩子函数原地改 state），
// 与卡的 effects 同构。数值为功能性游戏规则，遗物名为原创中文功能译名。
//
// 当前钩子点（M3a 轻量地基）：
//   - onCombatStart：战斗开始（敌人已 telegraph、发牌前）。
//   - onCombatEnd：战斗胜利结算（清 combat 前，可回血）。
// 更多钩子点（受击反弹 / 回合始末 / 出牌计数 / 亡语…）随后续里程碑的 hook 总线扩展。

export type RelicRarity = "starter" | "common" | "uncommon" | "rare" | "boss";

export type RelicHooks = {
  onCombatStart?: (state: GameState) => void;
  onCombatEnd?: (state: GameState) => void;
};

export type RelicDef = {
  id: string;
  name: string;
  rarity: RelicRarity;
  description: string;
  hooks: RelicHooks;
};

const BURNING_BLOOD_HEAL = 6;
const BLOOD_VIAL_HEAL = 2;
const ANCHOR_BLOCK = 10;
const LANTERN_ENERGY = 1;
const VAJRA_STRENGTH = 1;
const MARBLES_VULNERABLE = 1;

function healPlayer(state: GameState, amount: number): void {
  state.hp = Math.min(state.maxHp, state.hp + amount);
}

const RELIC_LIST: RelicDef[] = [
  {
    id: "burning_blood",
    name: "燃烧之血",
    rarity: "starter",
    description: "每场战斗结束后，回复 6 点生命。",
    hooks: {
      onCombatEnd: state => healPlayer(state, BURNING_BLOOD_HEAL),
    },
  },
  {
    id: "anchor",
    name: "船锚",
    rarity: "common",
    description: "每场战斗开始时，获得 10 点格挡。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          state.combat.playerBlock += ANCHOR_BLOCK;
        }
      },
    },
  },
  {
    id: "blood_vial",
    name: "血瓶",
    rarity: "common",
    description: "每场战斗开始时，回复 2 点生命。",
    hooks: {
      onCombatStart: state => healPlayer(state, BLOOD_VIAL_HEAL),
    },
  },
  {
    id: "vajra",
    name: "金刚杵",
    rarity: "common",
    description: "每场战斗开始时，获得 1 点力量。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          addPower(state.combat.playerPowers, "strength", VAJRA_STRENGTH);
        }
      },
    },
  },
  {
    id: "lantern",
    name: "提灯",
    rarity: "common",
    description: "每场战斗的第一回合，额外获得 1 点能量。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          state.combat.energy += LANTERN_ENERGY;
        }
      },
    },
  },
  {
    id: "bag_of_marbles",
    name: "弹珠袋",
    rarity: "common",
    description: "每场战斗开始时，令所有敌人获得 1 层易伤。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          for (const enemy of state.combat.enemies) {
            if (enemy.hp > 0) {
              addPower(enemy.powers, "vulnerable", MARBLES_VULNERABLE);
            }
          }
        }
      },
    },
  },
];

const RELIC_MAP: ReadonlyMap<string, RelicDef> = new Map(
  RELIC_LIST.map(relic => [relic.id, relic]),
);

export const ALL_RELICS: readonly RelicDef[] = RELIC_LIST;

export function getRelicDef(id: string): RelicDef {
  const def = RELIC_MAP.get(id);
  if (!def) {
    throw new Error(`未知遗物 id: ${id}`);
  }
  return def;
}

export function hasRelic(state: GameState, id: string): boolean {
  return state.relics.some(relic => relic.id === id);
}

/** 铁甲战士起始遗物。 */
export const IRONCLAD_STARTER_RELIC = "burning_blood";

/** 宝箱 / 战斗掉落的遗物池（common + uncommon，不含起始 / boss）。 */
export const COMMON_RELIC_POOL: readonly string[] = RELIC_LIST.filter(
  relic => relic.rarity === "common",
).map(relic => relic.id);
