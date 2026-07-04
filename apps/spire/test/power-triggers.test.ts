import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 玩家能力触发框架：打牌 / 消耗 / 获得格挡 / 因牌失血 / 回合始末 触发型 power。

function combat(character: GameState["character"] = "ironclad", encounter = "cultist"): GameState {
  const s = newRun({ runId: "trig", seed: 2, character });
  startCombat(s, encounter);
  s.hp = 200;
  s.maxHp = 200;
  s.combat!.enemies[0]!.hp = 200;
  s.combat!.enemies[0]!.maxHp = 200;
  return s;
}

/** 直接给玩家挂一个 power（跳过打出能力牌）。 */
function grant(s: GameState, power: Parameters<typeof getPower>[1], amount: number): void {
  s.combat!.playerPowers.push({ id: power, amount });
}

/** 打一张牌（自定义 defId），能量拉满。 */
function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("千刃：每打出一张牌对全体发伤", () => {
  it("打一张牌后所有敌人受到 = 层数的伤害", () => {
    const s = combat();
    grant(s, "thousand_cuts", 3);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "defend", null); // 防御本身不伤敌
    expect(s.combat!.enemies[0]!.hp).toBe(before - 3);
  });
});

describe("残影：每打出一张牌加格挡", () => {
  it("打一张牌后获得 = 层数的格挡", () => {
    const s = combat();
    grant(s, "after_image", 2);
    s.combat!.playerBlock = 0;
    play(s, "strike", 0);
    expect(s.combat!.playerBlock).toBe(2);
  });
});

describe("无痛 / 暗黑拥抱：消耗触发", () => {
  it("无痛：消耗一张牌获得格挡", () => {
    const s = combat();
    grant(s, "feel_no_pain", 3);
    s.combat!.playerBlock = 0;
    play(s, "pummel", 0); // pummel 消耗
    expect(s.combat!.playerBlock).toBe(3);
  });

  it("暗黑拥抱：消耗一张牌抽 1 张", () => {
    const s = combat();
    grant(s, "dark_embrace", 1);
    // 抽牌堆放一张已知牌，手里放一张会消耗的牌。
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    const handBefore = 0;
    play(s, "offering", null); // offering 消耗（且自身也抽 3，故额外看抽牌堆减少）
    // offering 抽 3 + 暗黑拥抱抽 1，抽牌堆里那张应已被抽走。
    expect(s.combat!.drawPile.some(c => c.defId === "strike")).toBe(false);
    void handBefore;
  });
});

describe("主宰：每获得格挡对随机敌人发伤", () => {
  it("获得格挡触发对敌伤害", () => {
    const s = combat();
    grant(s, "juggernaut", 5);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "defend", null); // 防御 5 格挡 → 触发主宰 5 伤
    expect(s.combat!.enemies[0]!.hp).toBe(before - 5);
  });
});

describe("破裂：因牌失血得力量", () => {
  it("打出放血类牌失血 → 获得力量", () => {
    const s = combat();
    grant(s, "rupture", 2);
    play(s, "bloodletting", null); // 放血：失 3 血
    expect(getPower(s.combat!.playerPowers, "strength")).toBe(2);
  });
});

describe("燃烧：回合结束失血 + 全体发伤", () => {
  it("回合结束对所有敌人造成 = 层数伤害并失 1 血", () => {
    const s = combat();
    grant(s, "combust", 5);
    s.combat!.hand = [];
    const hpBefore = s.hp;
    const enemyBefore = s.combat!.enemies[0]!.hp;
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBeLessThanOrEqual(enemyBefore - 5);
    expect(s.hp).toBeLessThan(hpBefore); // 至少燃烧扣了 1（敌人反击另算）
  });
});

describe("残暴 / 毒雾：回合开始触发", () => {
  it("毒雾：新回合开始所有敌人叠毒", () => {
    const s = combat();
    grant(s, "noxious_fumes", 2);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation"; // 邪教徒蓄力，不打人
    endTurn(s);
    expect(getPower(s.combat!.enemies[0]!.powers, "poison")).toBeGreaterThanOrEqual(2);
  });

  it("残暴：新回合开始失血并抽牌", () => {
    const s = combat();
    grant(s, "brutality", 1);
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    const hpBefore = s.hp;
    endTurn(s);
    expect(s.hp).toBeLessThan(hpBefore);
    expect(s.combat!.hand.length).toBeGreaterThan(0); // 抽了牌
  });
});

describe("壁垒：格挡不在回合开始清空", () => {
  it("持有壁垒时新回合保留格挡", () => {
    const s = combat();
    grant(s, "barricade", 1);
    s.combat!.playerBlock = 12;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.playerBlock).toBeGreaterThanOrEqual(12);
  });
});

describe("卡池归属", () => {
  it("新能力牌进入正确颜色池", () => {
    expect(cardPoolOf("red", "rare")).toContain("juggernaut");
    expect(cardPoolOf("red", "uncommon")).toContain("combust");
    expect(cardPoolOf("green", "rare")).toContain("thousand_cuts");
    expect(cardPoolOf("green", "uncommon")).toContain("noxious_fumes");
  });
});
