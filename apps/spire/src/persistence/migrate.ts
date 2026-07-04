import type { GameState } from "../engine/types.js";

// === 存档迁移 ===
//
// 引擎的 GameState 形状会随里程碑增长（C3 加充能球 orbs/orbSlots、C4 加姿态 playerStance、
// 三幕加 act/enemy.hasRevived、药水加 potions…）。老版本二进制存下的 save.json 会缺这些后加字段；
// 新二进制读回后若直接序列化，registerJsonRoute 的 output.parse 会因缺字段 500（表现为
// 「orbs / stance required」），把小镜的对局卡死。
//
// 迁移策略：读盘后回填**缺失**字段的默认值（只在 undefined 时填，不覆盖已有值），让老存档能继续，
// 而不是整局作废。加新字段时，若老存档缺了会崩，就在这里补一行默认值。

function backfill(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (obj[key] === undefined) {
    obj[key] = value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** 回填老存档缺失的后加字段，就地改并返回同一对象（类型收敛回 GameState）。 */
export function migrateLoadedState(raw: unknown): GameState {
  const state = asRecord(raw);
  if (!state) {
    // 不是对象（极端坏档）——交回上层，load 会当作无档处理。
    return raw as GameState;
  }
  // 顶层后加字段。
  backfill(state, "character", "ironclad");
  backfill(state, "ascension", 0);
  backfill(state, "act", 1);
  backfill(state, "potions", [null, null, null]);
  backfill(state, "potionDropBonus", 0);
  backfill(state, "combatsEntered", 0);
  backfill(state, "pendingRelicReward", false);

  const combat = asRecord(state["combat"]);
  if (combat) {
    // 充能球（C3）/ 姿态（C4）：老战斗存档没有，回填空/无。
    backfill(combat, "orbs", []);
    backfill(combat, "orbSlots", state["character"] === "defect" ? 3 : 0);
    backfill(combat, "playerStance", "none");
    backfill(combat, "mantra", 0); // 法力（观者神性）——老档没有。
    backfill(combat, "nextTurnBlock", 0);
    backfill(combat, "nextTurnEnergy", 0);
    backfill(combat, "nextTurnDraw", 0);
    backfill(combat, "nextTurnStance", null); // 烈怒渐起——老档没有。
    backfill(combat, "nightmarePending", null); // 噩梦——老档没有。
    backfill(combat, "extraTurnPending", false); // 宝库——老档没有。
    backfill(combat, "doomedNextTurn", false); // 亵渎——老档没有。
    backfill(combat, "nextTurnPhantasmal", false); // 幻杀——老档没有。
    backfill(combat, "attacksThisTurn", 0);
    backfill(combat, "cardsDiscardedThisTurn", 0); // 弃牌联动——老档没有。
    backfill(combat, "cardsPlayedThisTurn", 0); // 出牌计数——老档没有。
    backfill(combat, "mantraGainedThisCombat", 0); // 璀璨光辉——老档没有。
    backfill(combat, "frostChanneledThisCombat", 0); // 暴风雪——老档没有。
    backfill(combat, "lightningChanneledThisCombat", 0); // 雷霆一击——老档没有。
    backfill(combat, "powersPlayedThisCombat", 0); // 力场——老档没有。
    backfill(combat, "timesLostHpThisCombat", 0); // 血债血偿——老档没有。
    backfill(combat, "lastCardType", null);
    const enemies = Array.isArray(combat["enemies"]) ? combat["enemies"] : [];
    for (const entry of enemies) {
      const enemy = asRecord(entry);
      if (enemy) {
        backfill(enemy, "hasRevived", false); // 复活（三幕觉醒者）
        backfill(enemy, "hasSplit", false);
        backfill(enemy, "escaped", false);
        backfill(enemy, "curlUpConsumed", false);
        backfill(enemy, "asleep", false);
        backfill(enemy, "rolledDamage", 0);
        backfill(enemy, "moveHistory", []);
        backfill(enemy, "rotationIndex", 0);
        backfill(enemy, "modeShiftAccum", 0);
        backfill(enemy, "modeShiftThreshold", null);
        backfill(enemy, "stance", null);
        backfill(enemy, "powers", []);
      }
    }
  }
  return state as unknown as GameState;
}
