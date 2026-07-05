import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { grantRelic } from "../src/engine/relics/relics.js";

describe("大锅：获得时填满药水槽", () => {
  it("空槽全部填满", () => {
    const s = newRun({ runId: "cd", seed: 1, character: "ironclad" });
    grantRelic(s, "cauldron");
    expect(s.potions.every(p => p !== null)).toBe(true);
  });
});
describe("多莉的镜子：复制一张牌", () => {
  it("牌组 +1", () => {
    const s = newRun({ runId: "dm", seed: 1, character: "ironclad" });
    const size = s.deck.length;
    grantRelic(s, "dollys_mirror");
    expect(s.deck.length).toBe(size + 1);
  });
});
