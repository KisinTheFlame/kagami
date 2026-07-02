import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { applyChoose, currentOptions } from "../src/engine/run/run.js";
import { ALL_EVENTS, getEventDef } from "../src/engine/events/events.js";
import type { GameState } from "../src/engine/types.js";

// M4：事件（? 节点）——原创文案 + 复用金币/生命/牌组/遗物/药水结算。

function atEvent(eventId: string): GameState {
  const s = newRun({ runId: eventId, seed: 1 });
  s.event = { id: eventId };
  s.screen = "event";
  s.log = [];
  return s;
}

describe("事件数据", () => {
  it("每个事件都有描述和至少两个带结果文案的选项", () => {
    expect(ALL_EVENTS.length).toBeGreaterThanOrEqual(4);
    for (const event of ALL_EVENTS) {
      expect(event.description.length).toBeGreaterThan(0);
      expect(event.choices.length).toBeGreaterThanOrEqual(2);
      for (const choice of event.choices) {
        expect(choice.label.length).toBeGreaterThan(0);
        expect(choice.resultText.length).toBeGreaterThan(0);
        expect(choice.outcomes.length).toBeGreaterThan(0);
      }
    }
  });

  it("事件屏选项 = 各选择的 label", () => {
    const s = atEvent("cooling_embers");
    expect(currentOptions(s)).toEqual(getEventDef("cooling_embers").choices.map(c => c.label));
  });
});

describe("事件结算", () => {
  it("灰烬·取暖 → 回血；翻找 → +金币 -生命", () => {
    const heal = atEvent("cooling_embers");
    heal.hp = 50;
    heal.maxHp = 80;
    expect(applyChoose(heal, 0).ok).toBe(true);
    expect(heal.hp).toBe(62);
    expect(heal.screen).toBe("map");
    expect(heal.event).toBeNull();

    const dig = atEvent("cooling_embers");
    dig.hp = 50;
    dig.gold = 0;
    expect(applyChoose(dig, 1).ok).toBe(true);
    expect(dig.gold).toBe(30);
    expect(dig.hp).toBe(44);
  });

  it("神龛·祈祷 → 得遗物（或金币兜底）", () => {
    const s = atEvent("faceless_shrine");
    const relicsBefore = s.relics.length;
    const goldBefore = s.gold;
    expect(applyChoose(s, 0).ok).toBe(true);
    // 起始只有 1 遗物，池里有未持有的 → 应加一件遗物
    expect(s.relics.length === relicsBefore + 1 || s.gold > goldBefore).toBe(true);
  });

  it("商贩·施舍 → -金币 +药水", () => {
    const s = atEvent("lost_peddler");
    s.gold = 100;
    expect(applyChoose(s, 0).ok).toBe(true);
    expect(s.gold).toBe(75);
    expect(s.potions.filter(p => p !== null)).toHaveLength(1);
  });

  it("商贩·抢夺 → +金币，牌组塞入一张伤口", () => {
    const s = atEvent("lost_peddler");
    s.gold = 0;
    const deckBefore = s.deck.length;
    expect(applyChoose(s, 1).ok).toBe(true);
    expect(s.gold).toBe(45);
    expect(s.deck.length).toBe(deckBefore + 1);
    expect(s.deck.some(c => c.defId === "wound")).toBe(true);
  });

  it("蘑菇·尝一口 → +最大生命 +当前生命 -生命", () => {
    const s = atEvent("fungal_ring");
    s.hp = 40;
    s.maxHp = 80;
    expect(applyChoose(s, 0).ok).toBe(true);
    expect(s.maxHp).toBe(90); // +10
    expect(s.hp).toBe(45); // 40 +10 -5
  });

  it("失血不致死：至少留 1 点生命", () => {
    const s = atEvent("faceless_shrine");
    s.hp = 3; // 掀神像 -10
    expect(applyChoose(s, 1).ok).toBe(true);
    expect(s.hp).toBe(1);
  });

  it("非法选项被拒", () => {
    const s = atEvent("cooling_embers");
    expect(applyChoose(s, 9).ok).toBe(false);
  });
});
