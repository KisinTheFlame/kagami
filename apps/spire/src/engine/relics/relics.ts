import type { CardType, CharacterId, Effect, GameState, RelicState } from "../types.js";
import { addPower } from "../powers/powers.js";
import { getCardDef } from "../cards/cards.js";
import { nextInt } from "../rng.js";

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

type RelicRarity = "starter" | "common" | "uncommon" | "rare" | "boss";

/** emit：以玩家为行动者发射一个战斗 Effect（发伤 / AoE / 加牌走 add_card）。 */
type Emit = (effect: Effect) => void;

type RelicHooks = {
  onCombatStart?: (state: GameState, self: RelicState, emit: Emit) => void;
  onCombatEnd?: (state: GameState, self: RelicState, emit: Emit) => void;
  onTurnStart?: (state: GameState, self: RelicState, emit: Emit) => void;
  onTurnEnd?: (state: GameState, self: RelicState, emit: Emit) => void;
  onCardPlayed?: (state: GameState, self: RelicState, cardType: CardType, emit: Emit) => void;
  /** 获得该遗物时结算一次（草莓 +最大生命、药水腰带 +药水槽、磨刀石/战争彩绘升级牌）。局外，无 emit。 */
  onEquip?: (state: GameState, self: RelicState) => void;
  /** 玩家受到穿透格挡的伤害（失血）后结算（百年谜题首次失血抽牌）。可 emit 战斗 Effect。 */
  onLoseHp?: (state: GameState, self: RelicState, emit: Emit) => void;
  /** 每当一张牌被消耗（进消耗堆）后结算（卡戎之烬 AoE、枯枝加牌）。 */
  onExhaust?: (state: GameState, self: RelicState, emit: Emit) => void;
  /** 每当一个敌人被击杀（经攻击伤害致死）后结算（哥布林之角 +能量+抽牌）。 */
  onEnemyKilled?: (state: GameState, self: RelicState, emit: Emit) => void;
  /** 每当使用一瓶药水后结算（玩具扑翼机回血）。 */
  onUsePotion?: (state: GameState, self: RelicState, emit: Emit) => void;
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
  /** 角色专属：仅该角色的奖励 / 商店池里出现（省略=通用，任何角色可得）。 */
  characterLock?: CharacterId;
  hooks: RelicHooks;
};

const BURNING_BLOOD_HEAL = 6;
const BLOOD_VIAL_HEAL = 2;
const ANCHOR_BLOCK = 10;
const LANTERN_ENERGY = 1;
const VAJRA_STRENGTH = 1;
const MARBLES_VULNERABLE = 1;
const STRAWBERRY_MAX_HP = 7;
const AKABEKO_VIGOR = 8;
const PUZZLE_DRAW = 3;
const PREPARATION_DRAW = 2;
export const THE_BOOT_MIN_DAMAGE = 5; // 战靴：无格挡攻击伤害 ≤4 时改为的下限值。

function healPlayer(state: GameState, amount: number): void {
  state.hp = Math.min(state.maxHp, state.hp + amount);
}

/** 随机升级牌组中 count 张未升级的指定类型牌（磨刀石=攻击、战争彩绘=技能）。 */
function upgradeRandomCardsOfType(state: GameState, type: CardType, count: number): void {
  const candidates = state.deck.filter(
    card => !card.upgraded && getCardDef(card.defId).type === type,
  );
  for (let n = 0; n < count && candidates.length > 0; n += 1) {
    const idx = nextInt(state.rng, candidates.length);
    candidates[idx]!.upgraded = true;
    candidates.splice(idx, 1);
  }
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
    id: "ring_of_the_snake",
    name: "蛇之戒指",
    rarity: "starter",
    // 效果在 combat.ts 的 startCombat 里按 hasRelic 处理（额外抽牌不走钩子）。
    description: "每场战斗的第一回合，额外抽 2 张牌。",
    hooks: {},
  },
  {
    id: "cracked_core",
    name: "残破核心",
    rarity: "starter",
    // 效果在 combat.ts 的 startCombat 里按 hasRelic 处理（充能球不走钩子）。
    description: "每场战斗开始时，充能 1 颗闪电球。",
    hooks: {},
  },
  {
    id: "pure_water",
    name: "净水",
    rarity: "starter",
    // 效果在 combat.ts 的 startCombat 里按 hasRelic 处理（加牌不走钩子）。
    description: "每场战斗开始时，将 1 张奇迹加入手牌。",
    hooks: {},
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

  // —— 补全批次：通用遗物 ——
  {
    id: "nunchaku",
    name: "双节棍",
    rarity: "common",
    description: "每打出 10 张攻击牌，获得 1 点能量。",
    hooks: {
      onCardPlayed: (state, self, cardType) => {
        if (state.combat && cardType === "attack" && tickEvery(self, 10)) {
          state.combat.energy += 1;
        }
      },
    },
  },
  {
    id: "mercury_hourglass",
    name: "水银沙漏",
    rarity: "uncommon",
    description: "每个回合开始时，对所有敌人造成 3 点伤害。",
    hooks: {
      onTurnStart: (state, _self, emit) => {
        if (state.combat) {
          emit({ kind: "deal_damage_all", amount: 3 });
        }
      },
    },
  },
  {
    id: "pantograph",
    name: "缩放仪",
    rarity: "uncommon",
    description: "进入 Boss 战时，回复 25 点生命。",
    hooks: {
      onCombatStart: state => {
        if (state.combat?.isBoss) {
          healPlayer(state, 25);
        }
      },
    },
  },
  {
    id: "captains_wheel",
    name: "船长之轮",
    rarity: "rare",
    description: "第 3 个回合开始时，获得 18 点格挡。",
    hooks: {
      onTurnStart: (state, self) => {
        self.counter += 1;
        if (state.combat && self.counter === 3) {
          state.combat.playerBlock += 18;
        }
      },
    },
  },
  {
    id: "stone_calendar",
    name: "石历",
    rarity: "rare",
    description: "第 7 个回合结束时，对所有敌人造成 52 点伤害。",
    hooks: {
      onTurnEnd: (state, self, emit) => {
        self.counter += 1;
        if (state.combat && self.counter === 7) {
          emit({ kind: "deal_damage_all", amount: 52 });
        }
      },
    },
  },
  {
    id: "thread_and_needle",
    name: "织补针线",
    rarity: "rare",
    description: "每场战斗开始时，获得 4 层镀甲（每回合结束获得 4 点格挡）。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          addPower(state.combat.playerPowers, "plated_armor", 4);
        }
      },
    },
  },

  // —— 补全批次：角色专属遗物 ——
  {
    id: "red_mask",
    name: "赤红面具",
    rarity: "common",
    characterLock: "silent",
    description: "每场战斗开始时，令所有敌人获得 1 层虚弱。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          for (const enemy of state.combat.enemies) {
            if (enemy.hp > 0) {
              addPower(enemy.powers, "weak", 1);
            }
          }
        }
      },
    },
  },
  {
    id: "ninja_scroll",
    name: "忍者卷轴",
    rarity: "common",
    characterLock: "silent",
    description: "每场战斗开始时，将 3 张飞刀加入手牌。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          for (let i = 0; i < 3; i += 1) {
            state.combat.hand.push({ uid: state.nextUid++, defId: "shiv", upgraded: false });
          }
        }
      },
    },
  },
  {
    id: "twisted_funnel",
    name: "扭曲漏斗",
    rarity: "uncommon",
    characterLock: "silent",
    description: "每场战斗开始时，令所有敌人获得 4 层中毒。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          for (const enemy of state.combat.enemies) {
            if (enemy.hp > 0) {
              addPower(enemy.powers, "poison", 4);
            }
          }
        }
      },
    },
  },
  {
    id: "data_disk",
    name: "数据盘",
    rarity: "common",
    characterLock: "defect",
    description: "每场战斗开始时，获得 1 点集中。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          addPower(state.combat.playerPowers, "focus", 1);
        }
      },
    },
  },
  {
    id: "teardrop_locket",
    name: "泪滴坠饰",
    rarity: "uncommon",
    characterLock: "watcher",
    description: "每场战斗开始时，进入平静姿态。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          state.combat.playerStance = "calm";
        }
      },
    },
  },
  {
    id: "holy_water",
    name: "圣水",
    rarity: "rare",
    characterLock: "watcher",
    description: "每场战斗开始时，将 3 张奇迹加入手牌。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          for (let i = 0; i < 3; i += 1) {
            state.combat.hand.push({ uid: state.nextUid++, defId: "miracle", upgraded: false });
          }
        }
      },
    },
  },
  // —— 通用普通遗物批次（借新增的 onEquip / onLoseHp 钩子）——
  {
    id: "strawberry",
    name: "草莓",
    rarity: "common",
    description: "获得时，最大生命 +7。",
    hooks: {
      onEquip: state => {
        state.maxHp += STRAWBERRY_MAX_HP;
        state.hp += STRAWBERRY_MAX_HP;
      },
    },
  },
  {
    id: "potion_belt",
    name: "药水腰带",
    rarity: "common",
    description: "获得时，额外增加 2 个药水槽。",
    hooks: {
      onEquip: state => {
        state.potions.push(null, null);
      },
    },
  },
  {
    id: "whetstone",
    name: "磨刀石",
    rarity: "common",
    description: "获得时，随机升级 2 张攻击牌。",
    hooks: {
      onEquip: state => upgradeRandomCardsOfType(state, "attack", 2),
    },
  },
  {
    id: "war_paint",
    name: "战争彩绘",
    rarity: "common",
    description: "获得时，随机升级 2 张技能牌。",
    hooks: {
      onEquip: state => upgradeRandomCardsOfType(state, "skill", 2),
    },
  },
  {
    id: "akabeko",
    name: "赤红牛铃",
    rarity: "common",
    description: "每场战斗你的第一张攻击牌额外造成 8 点伤害。",
    hooks: {
      onCombatStart: state => {
        if (state.combat) {
          addPower(state.combat.playerPowers, "vigor", AKABEKO_VIGOR);
        }
      },
    },
  },
  {
    id: "bag_of_preparation",
    name: "行囊",
    rarity: "common",
    description: "每场战斗第一回合额外抽 2 张牌。",
    hooks: {
      onCombatStart: (_state, _self, emit) => emit({ kind: "draw", amount: PREPARATION_DRAW }),
    },
  },
  {
    id: "centennial_puzzle",
    name: "百年谜题",
    rarity: "common",
    description: "每场战斗中第一次失去生命时，抽 3 张牌。",
    hooks: {
      onCombatStart: (_state, self) => {
        self.counter = 0;
      },
      onLoseHp: (_state, self, emit) => {
        if (self.counter === 0) {
          self.counter = 1;
          emit({ kind: "draw", amount: PUZZLE_DRAW });
        }
      },
    },
  },
  {
    id: "the_boot",
    name: "战靴",
    // 伤害下限修正在 combat.ts 的 dealDamageToEnemy 里按 hasRelic 处理（不走钩子）。
    rarity: "common",
    description: "当你的一次无格挡攻击伤害为 4 或更低时，改为造成 5 点。",
    hooks: {},
  },
  // —— 通用遗物批次 2（借既有钩子：计数 / 回合始 / 失血 / 战斗始）——
  {
    id: "art_of_war",
    name: "战争艺术",
    rarity: "common",
    description: "若某个回合你没有打出攻击牌，下个回合开始时获得 1 点能量。",
    hooks: {
      onCombatStart: (_state, self) => {
        self.counter = 0;
      },
      onTurnStart: (_state, self, emit) => {
        if (self.counter === 0) {
          emit({ kind: "gain_energy", amount: 1 });
        }
        self.counter = 0;
      },
      onCardPlayed: (_state, self, cardType) => {
        if (cardType === "attack") {
          self.counter = 1;
        }
      },
    },
  },
  {
    id: "ink_bottle",
    name: "墨水瓶",
    rarity: "uncommon",
    description: "每打出 10 张牌，抽 1 张牌。",
    hooks: {
      onCardPlayed: (_state, self, _cardType, emit) => {
        if (tickEvery(self, 10)) {
          emit({ kind: "draw", amount: 1 });
        }
      },
    },
  },
  {
    id: "incense_burner",
    name: "熏香炉",
    rarity: "rare",
    description: "每过 6 个回合，获得 1 层虚无缥缈。",
    hooks: {
      onTurnStart: (_state, self, emit) => {
        if (tickEvery(self, 6)) {
          emit({ kind: "apply_power", power: "intangible", amount: 1, on: "self" });
        }
      },
    },
  },
  {
    id: "self_forming_clay",
    name: "自塑黏土",
    rarity: "uncommon",
    description: "每当你失去生命，下个回合开始时获得 3 点格挡。",
    hooks: {
      onLoseHp: (_state, _self, emit) => emit({ kind: "gain_block_next_turn", amount: 3 }),
    },
  },
  {
    id: "du_vu_doll",
    name: "杜巫娃娃",
    rarity: "rare",
    description: "牌组中每有一张诅咒牌，战斗开始时获得 1 点力量。",
    hooks: {
      onCombatStart: (state, _self, emit) => {
        const curses = state.deck.filter(card => getCardDef(card.defId).type === "curse").length;
        if (curses > 0) {
          emit({ kind: "apply_power", power: "strength", amount: curses, on: "self" });
        }
      },
    },
  },
  // —— 减伤 / 失血联动遗物批次 ——
  {
    id: "fossilized_helix",
    name: "化石螺壳",
    rarity: "rare",
    description: "每场战斗开始时，获得 1 层缓冲（抵消下一次会让你失去生命的伤害）。",
    hooks: {
      onCombatStart: (_state, _self, emit) =>
        emit({ kind: "apply_power", power: "buffer", amount: 1, on: "self" }),
    },
  },
  {
    id: "runic_cube",
    name: "符文魔方",
    rarity: "boss",
    characterLock: "ironclad",
    description: "每当你失去生命，抽 1 张牌。",
    hooks: {
      onLoseHp: (_state, _self, emit) => emit({ kind: "draw", amount: 1 }),
    },
  },
  {
    id: "torii",
    name: "鸟居",
    // 减伤在 combat.ts 的 dealDamageToPlayer 里按 hasRelic 处理（不走钩子）。
    rarity: "rare",
    description: "当你受到 5 点或更少的无格挡攻击伤害时，改为只受到 1 点。",
    hooks: {},
  },
  {
    id: "tungsten_rod",
    name: "钨钢棒",
    // 减伤在 combat.ts 的 dealDamageToPlayer 里按 hasRelic 处理（不走钩子）。
    rarity: "boss",
    description: "每当你失去生命时，少失去 1 点。",
    hooks: {},
  },
  // —— 消耗 / 击杀 / 用药水 触发型遗物批次 ——
  {
    id: "charons_ashes",
    name: "卡戎之烬",
    rarity: "rare",
    characterLock: "ironclad",
    description: "每当你消耗一张牌，对所有敌人造成 3 点伤害。",
    hooks: {
      onExhaust: (_state, _self, emit) => emit({ kind: "deal_damage_all", amount: 3 }),
    },
  },
  {
    id: "dead_branch",
    name: "枯枝",
    rarity: "rare",
    description: "每当你消耗一张牌，将一张随机无色牌加入手牌。",
    hooks: {
      onExhaust: (_state, _self, emit) => emit({ kind: "add_random_colorless", count: 1 }),
    },
  },
  {
    id: "gremlin_horn",
    name: "哥布林之角",
    rarity: "uncommon",
    description: "每当一个敌人死亡，获得 1 点能量并抽 1 张牌。",
    hooks: {
      onEnemyKilled: (_state, _self, emit) => {
        emit({ kind: "gain_energy", amount: 1 });
        emit({ kind: "draw", amount: 1 });
      },
    },
  },
  {
    id: "toy_ornithopter",
    name: "玩具扑翼机",
    rarity: "common",
    description: "每当你使用一瓶药水，回复 5 点生命。",
    hooks: {
      onUsePotion: (_state, _self, emit) => emit({ kind: "heal", amount: 5 }),
    },
  },
  // —— 计数 / 能量 触发型遗物批次 ——
  {
    id: "ice_cream",
    name: "冰淇淋",
    // 能量保留在 combat.ts 的回合开始处按 hasRelic 处理（不走钩子）。
    rarity: "rare",
    description: "能量在回合之间保留，不再于回合开始清零。",
    hooks: {},
  },
  {
    id: "pocketwatch",
    name: "怀表",
    rarity: "rare",
    description: "若某个回合你打出的牌不超过 3 张，下个回合开始时抽 3 张牌。",
    hooks: {
      onCombatStart: (_state, self) => {
        self.counter = 0;
      },
      onTurnStart: (_state, self, emit) => {
        if (self.counter === 1) {
          emit({ kind: "draw", amount: 3 });
        }
        self.counter = 0;
      },
      onTurnEnd: (state, self) => {
        // 本回合出牌 ≤3 → 预约下回合抽 3。
        self.counter = (state.combat?.cardsPlayedThisTurn ?? 99) <= 3 ? 1 : 0;
      },
    },
  },
  {
    id: "mummified_hand",
    name: "木乃伊手",
    rarity: "uncommon",
    description: "每当你打出一张能力牌，手牌中一张随机牌本回合费用变为 0。",
    hooks: {
      onCardPlayed: (_state, _self, cardType, emit) => {
        if (cardType === "power") {
          emit({ kind: "make_random_hand_card_free" });
        }
      },
    },
  },
];

/** 获得一件遗物：入列 + 结算 onEquip（草莓 +最大生命等一次性效果）。日志由调用方按情景补。 */
export function grantRelic(state: GameState, id: string): void {
  const self: RelicState = { id, counter: 0 };
  state.relics.push(self);
  getRelicDef(id).hooks.onEquip?.(state, self);
}

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

// 通用遗物（无 characterLock）按稀有度取 id；角色专属遗物由 relicIdsForCharacter 单独并入。
function relicIdsOfRarity(...rarities: RelicRarity[]): readonly string[] {
  const set = new Set(rarities);
  return RELIC_LIST.filter(relic => set.has(relic.rarity) && relic.characterLock === undefined).map(
    relic => relic.id,
  );
}

/** 某角色专属、且在给定稀有度里的遗物 id。 */
function relicIdsForCharacter(
  character: CharacterId,
  ...rarities: RelicRarity[]
): readonly string[] {
  const set = new Set(rarities);
  return RELIC_LIST.filter(relic => set.has(relic.rarity) && relic.characterLock === character).map(
    relic => relic.id,
  );
}

/** 通用宝箱 / 精英 / 事件掉落的遗物池（common + uncommon，不含角色专属）。 */
export const REWARD_RELIC_POOL: readonly string[] = relicIdsOfRarity("common", "uncommon");

/** 通用商店遗物池（含稀有，不含角色专属）。 */
export const SHOP_RELIC_POOL: readonly string[] = relicIdsOfRarity("common", "uncommon", "rare");

/** 某角色实际可得的掉落遗物池 = 通用 + 该角色专属（common + uncommon）。 */
export function rewardRelicPool(character: CharacterId): readonly string[] {
  return [...REWARD_RELIC_POOL, ...relicIdsForCharacter(character, "common", "uncommon")];
}

/** 某角色实际可得的商店遗物池 = 通用 + 该角色专属（含稀有）。 */
export function shopRelicPool(character: CharacterId): readonly string[] {
  return [...SHOP_RELIC_POOL, ...relicIdsForCharacter(character, "common", "uncommon", "rare")];
}
