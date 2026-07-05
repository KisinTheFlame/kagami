import { describe, expect, it } from "vitest";
import { newRun, applyAction } from "../src/engine/engine.js";
import { getEventDef } from "../src/engine/events/events.js";
import type { GameState } from "../src/engine/types.js";

// 事件补全批次：每个新事件的选项都能正常结算（金币/生命/最大生命/遗物/诅咒牌）。

function atEvent(id: string): GameState {
  const s = newRun({ runId: "ev", seed: 2, character: "ironclad" });
  s.screen = "event";
  s.event = { id };
  s.version = 1;
  s.gold = 500;
  return s;
}

const NEW_EVENTS = [
  "golden_idol",
  "big_fish",
  "golden_shrine",
  "the_serpent",
  "world_of_goop",
  "scrap_ooze",
  "the_cleric",
  "forgotten_altar",
  "wing_statue",
];

describe("新事件：结构完整、可结算", () => {
  for (const id of NEW_EVENTS) {
    it(`${id} 每个选项都能结算且离开事件屏`, () => {
      const def = getEventDef(id);
      expect(def.choices.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < def.choices.length; i += 1) {
        const s = atEvent(id);
        const r = applyAction(s, { type: "choose", optionIndex: i });
        expect(r.ok).toBe(true);
        expect(s.screen).not.toBe("event"); // 选完离开事件屏
      }
    });
  }
});

describe("关键事件的具体结果", () => {
  it("金像：抱走 → 得遗物 + 牌组多一张诅咒", () => {
    const s = atEvent("golden_idol");
    const relics = s.relics.length;
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.relics.length).toBe(relics + 1);
    expect(s.deck.some(c => c.defId === "injury")).toBe(true);
  });

  it("蛇：接过金币 → +175 金币 + 疑虑诅咒", () => {
    const s = atEvent("the_serpent");
    applyAction(s, { type: "choose", optionIndex: 0 });
    expect(s.gold).toBe(500 + 175);
    expect(s.deck.some(c => c.defId === "doubt")).toBe(true);
  });

  it("大鱼：甜甜圈 → 最大生命 +6", () => {
    const s = atEvent("big_fish");
    const maxHp = s.maxHp;
    applyAction(s, { type: "choose", optionIndex: 1 });
    expect(s.maxHp).toBe(maxHp + 6);
  });
});
