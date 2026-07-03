import type { CardType, Effect, GameState, RelicState } from "../types.js";
import { addPower } from "../powers/powers.js";

// === 遗物系统 ===
//
// 遗物是持久战力：在战斗流程的固定时点触发效果（复刻杀戮尖塔的 atBattleStart / onVictory 等）。
// state.relics 只存可序列化的 { id, counter }；遗物「行为」在这张表里按 id 查（钩子函数原地改 state），
// 与卡的 effects 同构。数值为功能性游戏规则，遗物名为原创中文功能译名。
//
// 钩子点：
//   - onCombatStart：战斗开始（敌人已 telegraph、发牌前）。
//   - onCombatEnd：战斗胜利结算（清 combat 前，可回血）。
//   - onTurnStart：每个玩家回合开始（含第 1 回合；能量重置后、抽牌前）。
//   - onTurnEnd：每个玩家回合结束（敌人行动前，可留格挡）。
//   - onCardPlayed：每打出一张牌后（计数型遗物用 self.counter）；可通过 emit 发射战斗 Effect
//     （发伤遗物如信封：以玩家为行动者结算）。
// 直接状态改动（力量/敏捷/格挡/能量/回血）在钩子里做；需要走伤害结算的用 emit 发 Effect。
// hooks 第二参 self 是该遗物自己的 RelicState，计数型遗物读写 self.counter。

export type RelicRarity = "starter" | "common" | "uncommon" | "rare" | "boss";

export type RelicHooks = {
  onCombatStart?: (state: GameState, self: RelicState) => void;
  onCombatEnd?: (state: GameState, self: RelicState) => void;
  onTurnStart?: (state: GameState, self: RelicState) => void;
  onTurnEnd?: (state: GameState, self: RelicState) => void;
  onCardPlayed?: (
    state: GameState,
    self: RelicState,
    cardType: CardType,
    emit: (effect: Effect) => void,
  ) => void;
};

/** 计数型遗物：自增 self.counter，达到 every 则归零并返回 true（触发效果）。 */
function tickEvery(self: RelicState, every: number): boolean {
  self.counter += 1;
  if (self.counter >= every) {
    self.counter = 0;
    return true;
  }
  return false;
}

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
  {
    id: "oddly_smooth_stone",
    name: "光滑石",
    rarity: "common",
    description: "每场战斗开始时，获得 1 点敏捷。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          addPower(state.combat.playerPowers, "dexterity", 1);
        }
      },
    },
  },
  {
    id: "shuriken",
    name: "手里剑",
    rarity: "common",
    description: "每打出 3 张攻击牌，获得 1 点力量。",
    hooks: {
      onCardPlayed: (state, self, cardType) => {
        if (state.combat && cardType === "attack" && tickEvery(self, 3)) {
          addPower(state.combat.playerPowers, "strength", 1);
        }
      },
    },
  },
  {
    id: "kunai",
    name: "苦无",
    rarity: "common",
    description: "每打出 3 张攻击牌，获得 1 点敏捷。",
    hooks: {
      onCardPlayed: (state, self, cardType) => {
        if (state.combat && cardType === "attack" && tickEvery(self, 3)) {
          addPower(state.combat.playerPowers, "dexterity", 1);
        }
      },
    },
  },
  {
    id: "ornamental_fan",
    name: "装饰扇",
    rarity: "uncommon",
    description: "每打出 3 张攻击牌，获得 4 点格挡。",
    hooks: {
      onCardPlayed: (state, self, cardType) => {
        if (state.combat && cardType === "attack" && tickEvery(self, 3)) {
          state.combat.playerBlock += 4;
        }
      },
    },
  },
  {
    id: "happy_flower",
    name: "欢乐花",
    rarity: "common",
    description: "每 3 个回合开始时，额外获得 1 点能量。",
    hooks: {
      onTurnStart: (state, self) => {
        if (state.combat && tickEvery(self, 3)) {
          state.combat.energy += 1;
        }
      },
    },
  },
  {
    id: "horn_cleat",
    name: "角锚",
    rarity: "common",
    description: "第 2 个回合开始时，获得 14 点格挡。",
    hooks: {
      onTurnStart: (state, self) => {
        self.counter += 1;
        if (state.combat && self.counter === 2) {
          state.combat.playerBlock += 14;
        }
      },
    },
  },
  {
    id: "orichalcum",
    name: "山铜",
    rarity: "common",
    description: "若回合结束时你没有格挡，获得 6 点格挡。",
    hooks: {
      onTurnEnd: state => {
        if (state.combat && state.combat.playerBlock === 0) {
          state.combat.playerBlock += 6;
        }
      },
    },
  },
  {
    id: "meat_on_the_bone",
    name: "带肉骨头",
    rarity: "uncommon",
    description: "战斗结束时若生命低于一半，回复 12 点生命。",
    hooks: {
      onCombatEnd: state => {
        if (state.hp <= Math.floor(state.maxHp / 2)) {
          healPlayer(state, 12);
        }
      },
    },
  },
  {
    id: "bird_faced_urn",
    name: "鸟面瓮",
    rarity: "rare",
    description: "每打出一张能力牌，回复 2 点生命。",
    hooks: {
      onCardPlayed: (state, _self, cardType) => {
        if (cardType === "power") {
          healPlayer(state, 2);
        }
      },
    },
  },
  {
    id: "bronze_scales",
    name: "青铜鳞片",
    rarity: "common",
    description: "每场战斗开始时，获得 3 层荆棘（被攻击时反弹 3 点伤害）。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          addPower(state.combat.playerPowers, "thorns", 3);
        }
      },
    },
  },
  {
    id: "letter_opener",
    name: "开信刀",
    rarity: "uncommon",
    description: "每打出 3 张技能牌，对所有敌人造成 5 点伤害。",
    hooks: {
      onCardPlayed: (_state, self, cardType, emit) => {
        if (cardType === "skill" && tickEvery(self, 3)) {
          emit({ kind: "deal_damage_all", amount: 5 });
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

function relicIdsOfRarity(...rarities: RelicRarity[]): readonly string[] {
  const set = new Set(rarities);
  return RELIC_LIST.filter(relic => set.has(relic.rarity)).map(relic => relic.id);
}

/** 宝箱 / 精英 / 事件掉落的遗物池（common + uncommon）。 */
export const REWARD_RELIC_POOL: readonly string[] = relicIdsOfRarity("common", "uncommon");

/** 商店遗物池（含稀有）。 */
export const SHOP_RELIC_POOL: readonly string[] = relicIdsOfRarity("common", "uncommon", "rare");
