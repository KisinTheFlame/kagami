import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import { getEventDef } from "../src/engine/events/events.js";
import type { GameState } from "../src/engine/types.js";

// 事件补全批次 4：靠后 ? 事件（既有 outcome）。

function atEvent(id: string): GameState {
  const s = newRun({ runId: "ev4", seed: 4, character: "ironclad" });
  s.screen = "event";
  s.event = { id };
  s.version = 1;
  s.gold = 400;
  return s;
}

const NEW_EVENTS = [
  "council_of_ghosts",
  "face_trader",
  "mind_bloom",
  "tomb_of_the_red_mask",
  "fountain_of_cleansing",
  "divine_fountain",
];

describe("事件批次 4：结构完整、可结算", () => {
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

describe("关键结果", () => {
  it("幽魂议会：收下 3 张幻影", () => {
    const s = atEvent("council_of_ghosts");
    const size = s.deck.length;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.deck.filter(c => c.defId === "apparition")).toHaveLength(3);
    expect(s.deck.length).toBe(size + 3);
  });

  it("红面陵墓：倾尽金币换遗物", () => {
    const s = atEvent("tomb_of_the_red_mask");
    const relics = s.relics.length;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.gold).toBe(0);
    expect(s.relics.length).toBe(relics + 1);
  });

  it("心灵之花：磨砺 3 张牌", () => {
    const s = atEvent("mind_bloom");
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.deck.filter(c => c.upgraded).length).toBe(3);
  });
});
