import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getCharacterConfig } from "../src/engine/characters/characters.js";
import { generateReward } from "../src/engine/run/run.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// C4：静心观者——姿态（平静/愤怒）+ 保留 + 净水 + 紫卡池。

function watcherCombat(encounter = "cultist"): GameState {
  const s = newRun({ runId: "watcher", seed: 1, character: "watcher" });
  startCombat(s, encounter);
  s.hp = 200;
  s.maxHp = 200;
  s.combat!.enemies[0]!.hp = 200;
  s.combat!.enemies[0]!.maxHp = 200;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("观者配置 + 净水", () => {
  it("72 血、紫色、净水、开局手牌含 1 张奇迹", () => {
    const c = getCharacterConfig("watcher");
    expect(c.maxHp).toBe(72);
    expect(c.color).toBe("purple");
    const s = watcherCombat();
    expect(s.combat!.hand.filter(card => card.defId === "miracle")).toHaveLength(1);
  });
});

describe("姿态：愤怒", () => {
  it("喷发进入愤怒；愤怒下攻击伤害翻倍", () => {
    const s = watcherCombat();
    play(s, "eruption", 0); // 9 伤 + 进入愤怒（进入前先结算 9 伤）
    expect(s.combat!.playerStance).toBe("wrath");
    expect(s.combat!.enemies[0]!.hp).toBe(191); // 喷发的 9 伤在进姿态前算，不翻倍
    // 愤怒下再打一张打击 → 6×2=12
    play(s, "strike", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(191 - 12);
  });

  it("愤怒下受到的伤害也翻倍", () => {
    const s = watcherCombat();
    s.combat!.playerStance = "wrath";
    s.hp = 100;
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "dark_strike"; // 暗袭 6
    endTurn(s);
    expect(s.hp).toBe(88); // 6×2=12
  });
});

describe("姿态：平静 + 离场能量", () => {
  it("警戒进入平静给 8 格挡；离开平静 +2 能量", () => {
    const s = watcherCombat();
    play(s, "vigilance", null);
    expect(s.combat!.playerStance).toBe("calm");
    expect(s.combat!.playerBlock).toBe(8);
    // 从平静进愤怒 → +2 能量（手动设能量 3，不走会重置能量的 play 助手）
    const cre: CardInstance = { uid: s.nextUid++, defId: "crescendo", upgraded: false };
    s.combat!.hand = [cre];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerStance).toBe("wrath");
    expect(s.combat!.energy).toBe(4); // 渐强 1 费：3-1+2(离开平静)=4
  });
});

describe("保留", () => {
  it("保留牌回合结束留在手中，不进弃牌堆", () => {
    const s = watcherCombat();
    const card: CardInstance = { uid: s.nextUid++, defId: "sands_of_time", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.hand.some(c => c.defId === "sands_of_time")).toBe(true);
    expect(s.combat!.discardPile.some(c => c.defId === "sands_of_time")).toBe(false);
  });

  it("非保留牌回合结束进弃牌堆", () => {
    const s = watcherCombat();
    const uid = s.nextUid++;
    const card: CardInstance = { uid, defId: "strike", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.enemies[0]!.currentMove = "incantation";
    endTurn(s);
    // 该具体打击实例（按 uid）应离开手牌进弃牌堆（新回合另抽的打击不算）。
    expect(s.combat!.hand.some(c => c.uid === uid)).toBe(false);
    expect(s.combat!.discardPile.some(c => c.uid === uid)).toBe(true);
  });
});

describe("紫色卡池", () => {
  it("观者奖励只给紫色卡", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const s = newRun({ runId: `p${seed}`, seed, character: "watcher" });
      generateReward(s);
      for (const choice of s.reward!.cardChoices) {
        expect(getCardDef(choice.defId).color).toBe("purple");
      }
    }
  });
});
