import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { cardPoolOf } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState, PowerId } from "../src/engine/types.js";

// 预知（观者，自动解算）：看牌顶 N 张、自动弃状态牌，其余留顶；涅槃格挡、疾书抽满。

function combat(): GameState {
  const s = newRun({ runId: "scry", seed: 14, character: "watcher" });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

function grant(s: GameState, power: PowerId, amount: number): void {
  s.combat!.playerPowers.push({ id: power, amount });
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("预知：自动弃状态牌", () => {
  it("第三只眼给格挡并弃掉顶部状态牌，非状态牌留顶", () => {
    const s = combat();
    // 顶 3 张（末端为顶）：defend / wound / strike。
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "wound", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.playerBlock = 0;
    play(s, "third_eye", null);
    expect(s.combat!.playerBlock).toBe(7);
    // wound 被弃，抽牌堆里不再有 wound。
    expect(s.combat!.drawPile.some(c => c.defId === "wound")).toBe(false);
    expect(s.combat!.discardPile.some(c => c.defId === "wound")).toBe(true);
    // 非状态牌仍在抽牌堆。
    expect(s.combat!.drawPile.filter(c => c.defId === "strike").length).toBeGreaterThan(0);
  });

  it("预知张数超过抽牌堆时安全处理", () => {
    const s = combat();
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "wound", upgraded: false }];
    play(s, "third_eye", null); // scry 3 但只有 1 张
    expect(s.combat!.drawPile).toHaveLength(0);
    expect(s.combat!.discardPile.some(c => c.defId === "wound")).toBe(true);
  });
});

describe("涅槃：每次预知加格挡", () => {
  it("预知触发涅槃格挡（叠加卡本身格挡）", () => {
    const s = combat();
    grant(s, "nirvana", 3);
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "strike", upgraded: false }];
    s.combat!.playerBlock = 0;
    play(s, "third_eye", null); // 第三只眼 7 格挡 + 涅槃 3
    expect(s.combat!.playerBlock).toBe(10);
  });
});

describe("斩断命运 / 侥幸", () => {
  it("斩断命运造成伤害并预知", () => {
    const s = combat();
    s.combat!.drawPile = [
      { uid: s.nextUid++, defId: "strike", upgraded: false },
      { uid: s.nextUid++, defId: "dazed", upgraded: false },
    ];
    const before = s.combat!.enemies[0]!.hp;
    play(s, "cut_through_fate", 0);
    expect(s.combat!.enemies[0]!.hp).toBe(before - 7);
    expect(s.combat!.drawPile.some(c => c.defId === "dazed")).toBe(false); // 眩晕被弃
  });
});

describe("疾书：抽到手牌满", () => {
  it("draw_to_full 抽到 10 张", () => {
    const s = combat();
    s.combat!.drawPile = Array.from({ length: 20 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    const card: CardInstance = { uid: s.nextUid++, defId: "scrawl", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // scrawl 打出离手（消耗），随后抽到满 10。
    expect(s.combat!.hand).toHaveLength(10);
  });
});

describe("卡池归属", () => {
  it("预知牌进入紫池", () => {
    expect(cardPoolOf("purple", "common")).toContain("third_eye");
    expect(cardPoolOf("purple", "common")).toContain("cut_through_fate");
    expect(cardPoolOf("purple", "uncommon")).toContain("nirvana");
    expect(cardPoolOf("purple", "rare")).toContain("scrawl");
  });
});
