import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import type { GameState } from "../src/engine/types.js";

// 事件补全批次 2：涉及去牌 / 升级 / 加牌的事件（新 EventOutcome）。

function atEvent(id: string): GameState {
  const s = newRun({ runId: "ev2", seed: 3, character: "ironclad" });
  s.screen = "event";
  s.event = { id };
  s.version = 1;
  return s;
}

describe("净化漩涡：移除一张牌（优先诅咒）", () => {
  it("牌组含诅咒时优先移除诅咒", () => {
    const s = atEvent("whirlpool_of_purity");
    s.deck.push({ uid: s.nextUid++, defId: "injury", upgraded: false });
    const size = s.deck.length;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.deck.length).toBe(size - 1);
    expect(s.deck.some(c => c.defId === "injury")).toBe(false);
  });
});

describe("闪光：受创并升级 2 张牌", () => {
  it("升级 2 张 + 掉血", () => {
    const s = atEvent("shining_light");
    const hp = s.hp;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.deck.filter(c => c.upgraded).length).toBe(2);
    expect(s.hp).toBe(hp - 12);
  });
});

describe("活墙：三种改牌选项", () => {
  it("遗忘 → 牌组 -1", () => {
    const s = atEvent("living_wall");
    const size = s.deck.length;
    applyAction(s, { type: "choose", optionIndex: 1 });
    expect(s.deck.length).toBe(size - 1);
  });

  it("深化 → 多一张升级牌", () => {
    const s = atEvent("living_wall");
    const upg = s.deck.filter(c => c.upgraded).length;
    applyAction(s, { type: "choose", optionIndex: 2 });
    expect(s.deck.filter(c => c.upgraded).length).toBe(upg + 1);
  });

  it("吸纳 → 牌组多一张", () => {
    const s = atEvent("living_wall");
    const size = s.deck.length;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.deck.length).toBe(size + 1);
  });
});
