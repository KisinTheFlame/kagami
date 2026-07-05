import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard } from "../src/engine/combat/combat.js";
import { getCardDef } from "../src/engine/cards/cards.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 十卡批次4：精算赌注/勾拳/子弹时间/深谋/急躁/净化/焚誓/双持/地狱之刃/启动程序。

function combat(character: "silent" | "ironclad" | "defect" | "watcher"): GameState {
  const s = newRun({ runId: "bt4", seed: 60, character });
  startCombat(s, "cultist");
  s.hp = 300;
  s.maxHp = 300;
  s.combat!.enemies[0]!.hp = 300;
  s.combat!.enemies[0]!.maxHp = 300;
  return s;
}

describe("精算赌注：弃整手抽等量", () => {
  it("弃 2 张抽 2 张", () => {
    const s = combat("silent");
    s.combat!.drawPile = Array.from({ length: 5 }, () => ({
      uid: s.nextUid++,
      defId: "defend",
      upgraded: false,
    }));
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "calculated_gamble", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 打出后手里剩 1 张 strike，弃掉后抽 1 张（弃的是 strike）→ 手里 1 张 defend。
    expect(s.combat!.hand).toHaveLength(1);
    expect(s.combat!.hand[0]!.defId).toBe("defend");
  });
});

describe("勾拳：目标虚弱则回能量抽牌", () => {
  it("虚弱 → +1 能量抽 1", () => {
    const s = combat("silent");
    s.combat!.enemies[0]!.powers = [{ id: "weak", amount: 1 }];
    s.combat!.drawPile = [{ uid: s.nextUid++, defId: "defend", upgraded: false }];
    const card: CardInstance = { uid: s.nextUid++, defId: "heel_hook", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat!.energy).toBe(3); // -1 +1
    expect(s.combat!.hand.some(c => c.defId === "defend")).toBe(true);
  });
});

describe("子弹时间：手牌变 0 费且禁抽", () => {
  it("贵牌变 0 费可打出", () => {
    const s = combat("silent");
    const wish: CardInstance = { uid: s.nextUid++, defId: "wish", upgraded: false };
    s.combat!.hand = [{ uid: s.nextUid++, defId: "bullet_time", upgraded: false }, wish];
    s.combat!.energy = 3;
    expect(playCard(s, 0, null).ok).toBe(true);
    s.combat!.hand = [wish];
    s.combat!.energy = 0;
    expect(playCard(s, 0, null).ok).toBe(true); // 祈愿原价 3，现 0
  });
});

describe("深谋：手牌置底变 0 费", () => {
  it("最贵手牌到抽牌堆底且 costZero", () => {
    const s = combat("ironclad");
    s.combat!.drawPile = [];
    const expensive: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [{ uid: s.nextUid++, defId: "forethought", upgraded: false }, expensive];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.drawPile[0]!.defId).toBe("defend");
    expect(s.combat!.drawPile[0]!.costZero).toBe(true);
  });
});

describe("急躁：无攻击牌则抽", () => {
  it("手里无攻击 → 抽 2", () => {
    const s = combat("ironclad");
    s.combat!.drawPile = Array.from({ length: 3 }, () => ({
      uid: s.nextUid++,
      defId: "defend",
      upgraded: false,
    }));
    const card: CardInstance = { uid: s.nextUid++, defId: "impatience", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "defend").length).toBe(2);
  });
});

describe("净化：消耗至多 N 张", () => {
  it("消耗手里两张（净化自身除外）", () => {
    const s = combat("ironclad");
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "purity", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 净化打出后手里 2 张，最多消耗 3 → 两张都消耗。
    expect(s.combat!.hand).toHaveLength(0);
    expect(s.combat!.exhaustPile.some(c => c.defId === "defend")).toBe(true);
  });
});

describe("焚誓：消耗一张抽两张", () => {
  it("消耗最低费牌并抽 2", () => {
    const s = combat("ironclad");
    s.combat!.drawPile = Array.from({ length: 3 }, () => ({
      uid: s.nextUid++,
      defId: "strike",
      upgraded: false,
    }));
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "burning_pact", upgraded: false },
      { uid: s.nextUid++, defId: "defend", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.exhaustPile.some(c => c.defId === "defend")).toBe(true);
    expect(s.combat!.hand.filter(c => c.defId === "strike").length).toBe(2);
  });
});

describe("双持：复制攻击/能力牌", () => {
  it("复制手里的打击一份", () => {
    const s = combat("ironclad");
    s.combat!.hand = [
      { uid: s.nextUid++, defId: "dual_wield", upgraded: false },
      { uid: s.nextUid++, defId: "strike", upgraded: false },
    ];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    // 手里原有 1 张 strike + 复制 1 张 = 2 张。
    expect(s.combat!.hand.filter(c => c.defId === "strike").length).toBe(2);
  });
});

describe("地狱之刃：随机免费攻击入手", () => {
  it("加入一张 0 费攻击牌", () => {
    const s = combat("ironclad");
    const card: CardInstance = { uid: s.nextUid++, defId: "infernal_blade", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    const added = s.combat!.hand.find(c => c.costZero);
    expect(added).toBeDefined();
    expect(getCardDef(added!.defId).type).toBe("attack");
  });
});

describe("启动程序：固有格挡", () => {
  it("获得 10 格挡并消耗", () => {
    const s = combat("defect");
    s.combat!.playerBlock = 0;
    const card: CardInstance = { uid: s.nextUid++, defId: "boot_sequence", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(s.combat!.playerBlock).toBe(10);
    expect(s.combat!.exhaustPile.some(c => c.defId === "boot_sequence")).toBe(true);
  });
});
