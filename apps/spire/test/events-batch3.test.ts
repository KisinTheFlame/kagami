import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import { getEventDef } from "../src/engine/events/events.js";
import type { GameState } from "../src/engine/types.js";

// 事件补全批次 3：交易 / 冒险类（既有 outcome）。

function atEvent(id: string): GameState {
  const s = newRun({ runId: "ev3", seed: 7, character: "ironclad" });
  s.screen = "event";
  s.event = { id };
  s.version = 1;
  s.gold = 300;
  s.hp = 60;
  s.maxHp = 80;
  return s;
}

const NEW_EVENTS = [
  "knowing_skull",
  "the_nest",
  "the_mausoleum",
  "cursed_tome",
  "winding_halls",
  "sensory_stone",
  "falling_pit",
];

describe("事件批次 3：结构完整、可结算", () => {
  for (const id of NEW_EVENTS) {
    it(`${id} 每个选项都能结算且离开事件屏`, () => {
      const def = getEventDef(id);
      for (let i = 0; i < def.choices.length; i += 1) {
        const s = atEvent(id);
        const r = applyAction(s, { type: "choose", optionIndex: i });
        expect(r.ok).toBe(true);
        expect(s.screen).not.toBe("event");
      }
    });
  }
});

describe("会说话的头骨：付血换金币", () => {
  it("选项 0 → 失 6 生命、+90 金币", () => {
    const s = atEvent("knowing_skull");
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.hp).toBe(60 - 6);
    expect(s.gold).toBe(300 + 90);
  });
});

describe("坠落深渊：抓藤蔓丢一张牌", () => {
  it("选项 0 → 牌组 -1", () => {
    const s = atEvent("falling_pit");
    const size = s.deck.length;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.deck.length).toBe(size - 1);
  });
});
