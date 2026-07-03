import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getEnemyDef } from "../src/engine/enemies/enemies.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 第三幕内容补齐：觉醒者复活、无常消散、巨型头颅蓄势、新怪进池。

function combatWith(encounter: string): GameState {
  const s = newRun({ runId: "a3", seed: 7, character: "ironclad" });
  startCombat(s, encounter);
  s.hp = 999;
  s.maxHp = 999;
  return s;
}

function killBlow(s: GameState): void {
  // 把敌人压到 1 血再用一张打击（≥6 伤）打死，让致死走 dealDamageToEnemy（复活逻辑在里面）。
  s.combat!.enemies[0]!.hp = 1;
  s.combat!.enemies[0]!.block = 0;
  const card: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 9;
  playCard(s, 0, 0);
}

describe("觉醒者：死亡后复活二阶段", () => {
  it("首次死亡复活到 reviveHp 并获得力量，第二次死亡才真正倒下", () => {
    const s = combatWith("awakened_one");
    expect(getEnemyDef("awakened_one").reviveHp).toBe(300);

    // 打空第一阶段 → 触发复活。
    killBlow(s);

    const e2 = s.combat!.enemies[0]!;
    expect(e2.hasRevived).toBe(true);
    expect(e2.hp).toBe(300);
    expect(e2.powers.find(p => p.id === "strength")?.amount).toBe(3);
    expect(s.combat).not.toBeNull();

    // 第二次打空 → 真死，战斗结束。
    killBlow(s);
    expect(s.combat).toBeNull();
  });
});

describe("无常：连续攻击后消散离场", () => {
  it("第 5 回合选择消散（逃跑）", () => {
    const s = combatWith("transient");
    const enemy = s.combat!.enemies[0]!;
    // 前几回合都是重殴。
    expect(enemy.currentMove).toBe("transient_slam");
    // 空推进若干回合，直到消散离场（fade 在第 5 回合被选中、第 6 回合执行）。
    let gone = false;
    for (let t = 0; t < 8; t += 1) {
      s.combat!.hand = [];
      endTurn(s);
      if (s.combat === null || s.combat.enemies[0]!.escaped) {
        gone = true;
        break;
      }
    }
    expect(gone).toBe(true);
  });
});

describe("巨型头颅：前 3 回合凝视，之后重击", () => {
  it("开局出凝视，蓄势 3 回合后转为时候到了", () => {
    const s = combatWith("giant_head");
    const enemy = s.combat!.enemies[0]!;
    expect(enemy.currentMove).toBe("gh_glare");
    enemy.moveHistory = ["gh_glare", "gh_glare", "gh_glare"];
    // 重新选招。
    s.combat!.hand = [];
    endTurn(s);
    expect(s.combat!.enemies[0]!.currentMove).toBe("it_is_time");
  });

  it("500 血高耐久精英", () => {
    expect(getEnemyDef("giant_head").hpMin).toBe(500);
  });
});

describe("斥力怪：撞击 + 斥力塞晕眩", () => {
  it("斥力把晕眩塞进抽牌堆", () => {
    const s = combatWith("repulsor");
    const enemy = s.combat!.enemies[0]!;
    enemy.currentMove = "repulse";
    const before = s.combat!.drawPile.filter(c => c.defId === "dazed").length;
    s.combat!.hand = [];
    endTurn(s);
    const after = s.combat!.drawPile.filter(c => c.defId === "dazed").length;
    expect(after).toBeGreaterThan(before);
  });
});
