import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { rewardRelicPool, shopRelicPool } from "../src/engine/relics/relics.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 遗物补全：钩子 emit 扩到回合/战斗时点、角色专属遗物、新遗物效果。

function withRelics(
  relics: string[],
  character: GameState["character"] = "ironclad",
  encounter = "cultist",
): GameState {
  const s = newRun({ runId: "relic", seed: 4, character });
  for (const id of relics) {
    s.relics.push({ id, counter: 0 });
  }
  startCombat(s, encounter);
  return s;
}

describe("回合开始遗物发伤（emit 扩到 onTurnStart）", () => {
  it("水银沙漏第 1 回合对所有敌人造成 3 点伤害", () => {
    const s = withRelics(["mercury_hourglass"]);
    // 第 1 回合开始钩子在 startCombat 内已触发。
    for (const e of s.combat!.enemies) {
      expect(e.hp).toBe(e.maxHp - 3);
    }
  });
});

describe("回合开始遗物发伤能正确结算战斗（回归：曾致 stuck）", () => {
  it("水银沙漏在新回合开始打死最后残敌 → 战斗结束不卡死", () => {
    const s = withRelics(["mercury_hourglass"]);
    s.hp = 500;
    s.maxHp = 500;
    // 单个敌人压到 2 血：其行动不自伤，回合末仍活；下个回合始水银 3 伤打死。
    s.combat!.enemies[0]!.hp = 2;
    s.combat!.hand = [];
    endTurn(s);
    // 回合始 AoE 结算了胜利：combat 已清空（非 boss 由 run 层生成奖励）。
    expect(s.combat).toBeNull();
  });
});

describe("回合结束遗物发伤", () => {
  it("石历在第 7 回合结束时对所有敌人造成 52 点伤害", () => {
    const s = withRelics(["stone_calendar"]);
    for (const e of s.combat!.enemies) {
      e.hp = 200;
      e.maxHp = 200;
    }
    const relic = s.relics.find(r => r.id === "stone_calendar")!;
    relic.counter = 6; // 下一次回合结束即第 7 次。
    s.combat!.hand = [];
    endTurn(s);
    for (const e of s.combat!.enemies) {
      expect(e.hp).toBeLessThanOrEqual(200 - 52);
    }
  });
});

describe("计数型遗物", () => {
  it("双节棍每 10 张攻击牌给 1 能量", () => {
    const s = withRelics(["nunchaku"]);
    s.relics.find(r => r.id === "nunchaku")!.counter = 9;
    const before = s.combat!.energy;
    const card: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 5;
    playCard(s, 0, 0);
    expect(s.combat!.energy).toBe(5 - 1 + 1); // 出击 -1 费 + 双节棍 +1
    void before;
  });
});

describe("战斗开始遗物（既有 emit-less 直改）", () => {
  it("织补针线开局给 4 层镀甲", () => {
    const s = withRelics(["thread_and_needle"]);
    expect(getPower(s.combat!.playerPowers, "plated_armor")).toBe(4);
  });

  it("缩放仪在 Boss 战开局回 25 血", () => {
    const s = newRun({ runId: "panto", seed: 4, character: "ironclad" });
    s.relics.push({ id: "pantograph", counter: 0 });
    s.hp = 40;
    s.maxHp = 100;
    startCombat(s, "hexaghost");
    expect(s.hp).toBe(65);
  });

  it("缩放仪在普通战不触发", () => {
    const s = withRelics(["pantograph"]);
    // cultist 非 Boss；hp 应保持满（newRun 满血）。
    expect(s.hp).toBe(s.maxHp);
  });
});

describe("角色专属遗物", () => {
  it("忍者卷轴开局给静默 3 张飞刀", () => {
    const s = withRelics(["ninja_scroll"], "silent");
    expect(s.combat!.hand.filter(c => c.defId === "shiv")).toHaveLength(3);
  });

  it("扭曲漏斗开局给所有敌人 4 层中毒", () => {
    const s = withRelics(["twisted_funnel"], "silent");
    for (const e of s.combat!.enemies) {
      expect(getPower(e.powers, "poison")).toBe(4);
    }
  });

  it("泪滴坠饰让观者开局进入平静", () => {
    const s = withRelics(["teardrop_locket"], "watcher");
    expect(s.combat!.playerStance).toBe("calm");
  });

  it("圣水开局给观者 3 张奇迹（叠加起始遗物净水的 1 张 = 4）", () => {
    const s = withRelics(["holy_water"], "watcher");
    // 观者起始遗物净水另加 1 张奇迹，故共 4 张。
    expect(s.combat!.hand.filter(c => c.defId === "miracle")).toHaveLength(4);
  });

  it("数据盘开局给机器人 1 点集中", () => {
    const s = withRelics(["data_disk"], "defect");
    expect(getPower(s.combat!.playerPowers, "focus")).toBe(1);
  });
});

describe("角色专属遗物只进对应角色的池", () => {
  it("静默池含赤红面具/忍者卷轴，铁甲池不含", () => {
    expect(rewardRelicPool("silent")).toContain("red_mask");
    expect(rewardRelicPool("silent")).toContain("ninja_scroll");
    expect(rewardRelicPool("ironclad")).not.toContain("red_mask");
    expect(rewardRelicPool("ironclad")).not.toContain("ninja_scroll");
  });

  it("圣水（稀有·观者）只在观者商店池", () => {
    expect(shopRelicPool("watcher")).toContain("holy_water");
    expect(shopRelicPool("ironclad")).not.toContain("holy_water");
  });

  it("通用遗物对所有角色可得", () => {
    for (const c of ["ironclad", "silent", "defect", "watcher"] as const) {
      expect(rewardRelicPool(c)).toContain("nunchaku");
      expect(shopRelicPool(c)).toContain("stone_calendar");
    }
  });
});
