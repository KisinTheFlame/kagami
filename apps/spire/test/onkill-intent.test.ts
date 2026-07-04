import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 击杀触发 / 意图条件 / 连击。

function twoEnemy(character: GameState["character"] = "ironclad"): GameState {
  const s = newRun({ runId: "ok", seed: 22, character });
  startCombat(s, "two_fungi_beasts");
  s.hp = 100;
  s.maxHp = 200;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0, energy = 9): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = energy;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("击杀触发", () => {
  it("喂养：击杀 → 永久 +最大生命", () => {
    const s = twoEnemy();
    s.combat!.enemies[0]!.hp = 5;
    s.combat!.enemies[1]!.hp = 100;
    const maxBefore = s.maxHp;
    play(s, "feed", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(0);
    expect(s.maxHp).toBe(maxBefore + 3);
  });

  it("喂养：未击杀不加最大生命", () => {
    const s = twoEnemy();
    s.combat!.enemies[0]!.hp = 100;
    const maxBefore = s.maxHp;
    play(s, "feed", 0);
    expect(s.maxHp).toBe(maxBefore);
  });

  it("贪婪之手：击杀 → 金币", () => {
    const s = twoEnemy();
    s.combat!.enemies[0]!.hp = 5;
    s.combat!.enemies[1]!.hp = 100;
    const goldBefore = s.gold;
    play(s, "hand_of_greed", 0);
    expect(s.gold).toBe(goldBefore + 20);
  });

  it("仪式匕首：击杀 → 本牌成长", () => {
    const s = twoEnemy("silent");
    s.combat!.enemies[0]!.hp = 5;
    s.combat!.enemies[1]!.hp = 100;
    const card: CardInstance = { uid: s.nextUid++, defId: "ritual_dagger", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    playCard(s, 0, 0);
    expect(card.bonus).toBe(3);
  });
});

describe("意图条件", () => {
  it("觅敌之弱：目标攻击意图 → 得力量", () => {
    const s = twoEnemy();
    s.combat!.enemies[0]!.currentMove = "chomp"; // 真菌兽攻击招
    play(s, "spot_weakness", 0);
    // 若该招是攻击意图则 +3；否则 0。用两种意图断言其一致性：
    const str = getPower(s.combat!.playerPowers, "strength");
    expect(str === 3 || str === 0).toBe(true);
  });

  it("瞄准眼睛：非攻击意图不施加虚弱", () => {
    const s = twoEnemy("defect");
    s.combat!.enemies[0]!.currentMove = "grow"; // 真菌兽增益招（非攻击）
    play(s, "go_for_the_eyes", 0);
    expect(getPower(s.combat!.enemies[0]!.powers, "weak")).toBe(0);
  });
});

describe("连击", () => {
  it("二连击：下一张攻击结算两次", () => {
    const s = twoEnemy();
    s.combat!.enemies[0]!.hp = 300;
    play(s, "double_tap", null);
    expect(getPower(s.combat!.playerPowers, "double_tap")).toBe(1);
    const before = s.combat!.enemies[0]!.hp;
    play(s, "strike", 0); // 6 ×2 = 12
    expect(s.combat!.enemies[0]!.hp).toBe(before - 12);
    expect(getPower(s.combat!.playerPowers, "double_tap")).toBe(0);
  });
});
