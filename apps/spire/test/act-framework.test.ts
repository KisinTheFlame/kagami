import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { advanceToNextAct, TOTAL_ACTS } from "../src/engine/run/run.js";

// B1：幕框架——幕号、跨幕携带状态、Boss→下一幕过渡机制。

describe("幕状态", () => {
  it("新对局在第 1 幕", () => {
    const s = newRun({ runId: "a", seed: 1 });
    expect(s.act).toBe(1);
  });

  it("TOTAL_ACTS 至少 1（有内容的幕数）", () => {
    expect(TOTAL_ACTS).toBeGreaterThanOrEqual(1);
  });
});

describe("进入下一幕", () => {
  it("幕号 +1、重置本幕战斗计数、生成新地图、回到地图屏", () => {
    const s = newRun({ runId: "b", seed: 1 });
    s.combatsEntered = 5;
    s.currentNodeId = "3-2";
    const oldMap = s.map;
    advanceToNextAct(s);
    expect(s.act).toBe(2);
    expect(s.combatsEntered).toBe(0);
    expect(s.currentNodeId).toBeNull();
    expect(s.screen).toBe("map");
    expect(s.map).not.toBe(oldMap); // 新地图对象
    expect(s.map.startNodeIds.length).toBeGreaterThan(0);
  });

  it("携带血量/牌组/遗物/金币/药水进入下一幕", () => {
    const s = newRun({ runId: "c", seed: 1 });
    s.hp = 42;
    s.maxHp = 88;
    s.gold = 217;
    s.deck.push({ uid: s.nextUid++, defId: "bludgeon", upgraded: true });
    s.relics.push({ id: "anchor", counter: 0 });
    s.potions[0] = "fire_potion";
    const deckLen = s.deck.length;
    const relicLen = s.relics.length;
    advanceToNextAct(s);
    expect(s.hp).toBe(42);
    expect(s.maxHp).toBe(88);
    expect(s.gold).toBe(217);
    expect(s.deck).toHaveLength(deckLen);
    expect(s.deck.some(c => c.defId === "bludgeon" && c.upgraded)).toBe(true);
    expect(s.relics).toHaveLength(relicLen);
    expect(s.potions[0]).toBe("fire_potion");
  });

  it("可连续推进多幕", () => {
    const s = newRun({ runId: "d", seed: 1 });
    advanceToNextAct(s);
    advanceToNextAct(s);
    expect(s.act).toBe(3);
  });
});
