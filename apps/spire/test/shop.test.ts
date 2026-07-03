import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { generateShop } from "../src/engine/shop/shop.js";
import { applyChoose, currentOptions } from "../src/engine/run/run.js";
import type { GameState } from "../src/engine/types.js";

// A1：商店节点——买卡/遗物/药水，闭合金币经济。

function shop(): GameState {
  const s = newRun({ runId: "shop", seed: 1 });
  generateShop(s);
  return s;
}

describe("商店库存", () => {
  it("进店切到 shop 屏、生成 5 卡 + 2 遗物 + 3 药水", () => {
    const s = shop();
    expect(s.screen).toBe("shop");
    const items = s.shop!.items;
    expect(items.filter(i => i.kind === "card")).toHaveLength(5);
    expect(items.filter(i => i.kind === "relic").length).toBeLessThanOrEqual(2);
    expect(items.filter(i => i.kind === "potion")).toHaveLength(3);
    for (const item of items) {
      expect(item.cost).toBeGreaterThan(0);
      expect(item.sold).toBe(false);
    }
  });

  it("选项 = 各商品 + 离开", () => {
    const s = shop();
    const options = currentOptions(s);
    expect(options).toHaveLength(s.shop!.items.length + 1);
    expect(options[options.length - 1]).toBe("离开商店");
  });
});

describe("购买", () => {
  it("买一张牌：扣金币、进牌组、标记售罄、留在店里", () => {
    const s = shop();
    const cardIdx = s.shop!.items.findIndex(i => i.kind === "card");
    const item = s.shop!.items[cardIdx]!;
    s.gold = item.cost + 100;
    const deckBefore = s.deck.length;
    expect(applyChoose(s, cardIdx).ok).toBe(true);
    expect(s.gold).toBe(100);
    expect(s.deck.length).toBe(deckBefore + 1);
    expect(s.shop!.items[cardIdx]!.sold).toBe(true);
    expect(s.screen).toBe("shop"); // 留在店里
  });

  it("金币不足被拒", () => {
    const s = shop();
    const idx = 0;
    s.gold = 0;
    const r = applyChoose(s, idx);
    expect(r.ok).toBe(false);
    expect(s.shop!.items[idx]!.sold).toBe(false);
  });

  it("已售商品不能再买", () => {
    const s = shop();
    s.gold = 9999;
    expect(applyChoose(s, 0).ok).toBe(true);
    expect(applyChoose(s, 0).ok).toBe(false); // 第二次已售罄
  });

  it("买遗物进遗物栏、买药水进空槽", () => {
    const s = shop();
    s.gold = 9999;
    const relicIdx = s.shop!.items.findIndex(i => i.kind === "relic");
    if (relicIdx >= 0) {
      const relicsBefore = s.relics.length;
      expect(applyChoose(s, relicIdx).ok).toBe(true);
      expect(s.relics.length).toBe(relicsBefore + 1);
    }
    const potionIdx = s.shop!.items.findIndex(i => i.kind === "potion");
    expect(applyChoose(s, potionIdx).ok).toBe(true);
    expect(s.potions.filter(p => p !== null).length).toBeGreaterThanOrEqual(1);
  });

  it("药水槽满时买药水被拒", () => {
    const s = shop();
    s.gold = 9999;
    s.potions = ["fire_potion", "fire_potion", "fire_potion"];
    const potionIdx = s.shop!.items.findIndex(i => i.kind === "potion");
    expect(applyChoose(s, potionIdx).ok).toBe(false);
  });
});

describe("离开", () => {
  it("选最后一项离开 → 回地图、清空 shop", () => {
    const s = shop();
    const leaveIdx = s.shop!.items.length;
    expect(applyChoose(s, leaveIdx).ok).toBe(true);
    expect(s.screen).toBe("map");
    expect(s.shop).toBeNull();
  });
});
