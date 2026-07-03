import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import { getEncounterDef } from "../src/engine/enemies/enemies.js";
import type { CardInstance, EnemyState, GameState } from "../src/engine/types.js";

// M3c-2：地精帮——狂怒(受击加力量)/护盾(保护友军)/巫师(蓄力大招)。asc0。

function gangFight(): GameState {
  const s = newRun({ runId: "gang", seed: 1 });
  startCombat(s, "gremlin_gang");
  s.hp = 500;
  s.maxHp = 500;
  return s;
}

function byDef(s: GameState, defId: string): EnemyState {
  return s.combat!.enemies.find(e => e.defId === defId)!;
}

function indexOf(s: GameState, defId: string): number {
  return s.combat!.enemies.findIndex(e => e.defId === defId);
}

function play(s: GameState, defId: string, target: number | null): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("地精帮组成", () => {
  it("固定 4 只：狂暴/鬼祟/护盾/巫师", () => {
    expect(getEncounterDef("gremlin_gang").enemies).toEqual([
      "mad_gremlin",
      "sneaky_gremlin",
      "shield_gremlin",
      "gremlin_wizard",
    ]);
  });
});

describe("狂暴地精：狂怒", () => {
  it("开局狂怒 1，受攻击伤害就 +1 力量", () => {
    const s = gangFight();
    const mad = byDef(s, "mad_gremlin");
    expect(getPower(mad.powers, "angry")).toBe(1);
    expect(getPower(mad.powers, "strength")).toBe(0);
    mad.hp = 100; // 抬血防秒
    mad.maxHp = 100;
    play(s, "strike", indexOf(s, "mad_gremlin")); // 6 伤穿透
    expect(getPower(byDef(s, "mad_gremlin").powers, "strength")).toBe(1);
  });

  it("被格挡挡下的攻击不触发狂怒", () => {
    const s = gangFight();
    const mad = byDef(s, "mad_gremlin");
    mad.hp = 100;
    mad.block = 50; // 挡下打击
    play(s, "strike", indexOf(s, "mad_gremlin"));
    expect(getPower(byDef(s, "mad_gremlin").powers, "strength")).toBe(0);
  });
});

describe("护盾地精：保护友军", () => {
  it("有友军时保护（给友军加格挡），只剩自己时改攻击", () => {
    const s = gangFight();
    const shield = byDef(s, "shield_gremlin");
    expect(shield.currentMove).toBe("protect");
    // 杀掉除护盾外所有地精
    for (const e of s.combat!.enemies) {
      if (e.defId !== "shield_gremlin") {
        e.hp = 0;
      }
    }
    // 触发一次 selectNextMove（通过 endTurn 后重新 telegraph）
    endTurn(s);
    expect(byDef(s, "shield_gremlin").currentMove).toBe("shield_bash");
  });

  it("保护给一名友军加 7 格挡", () => {
    const s = gangFight();
    // 只留护盾 + 狂暴，护盾 protect 会给狂暴加 7 格挡
    byDef(s, "sneaky_gremlin").hp = 0;
    byDef(s, "gremlin_wizard").hp = 0;
    const madIdx = indexOf(s, "mad_gremlin");
    s.combat!.enemies[madIdx]!.block = 0;
    // 强制护盾出 protect 并执行
    byDef(s, "shield_gremlin").currentMove = "protect";
    endTurn(s);
    expect(s.combat!.enemies[madIdx]!.block).toBeGreaterThanOrEqual(7);
  });
});

describe("地精巫师：蓄力大招", () => {
  it("蓄力 3 回合后终极爆发 25，然后循环", () => {
    const s = gangFight();
    // 杀掉其他地精，隔离巫师
    for (const e of s.combat!.enemies) {
      if (e.defId !== "gremlin_wizard") {
        e.hp = 0;
      }
    }
    const wiz = () => byDef(s, "gremlin_wizard");
    const seq: string[] = [wiz().currentMove];
    for (let i = 0; i < 4; i += 1) {
      s.hp = 500;
      s.combat!.playerBlock = 0;
      endTurn(s);
      seq.push(wiz().currentMove);
    }
    expect(seq).toEqual(["charging", "charging", "charging", "ultimate_blast", "charging"]);
  });

  it("终极爆发造成 25 伤害", () => {
    const s = gangFight();
    for (const e of s.combat!.enemies) {
      if (e.defId !== "gremlin_wizard") {
        e.hp = 0;
      }
    }
    byDef(s, "gremlin_wizard").currentMove = "ultimate_blast";
    s.hp = 500;
    s.combat!.playerBlock = 0;
    endTurn(s);
    expect(s.hp).toBe(500 - 25);
  });
});
