import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { pickBossEncounter } from "../src/engine/enemies/enemies.js";
import { seedRng } from "../src/engine/rng.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// M3d-2：半血分裂机制 + 大史莱姆 + 史莱姆王。asc0。

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 500;
  s.maxHp = 500;
  return s;
}

function play(s: GameState, defId: string, target: number | null = 0): void {
  const card: CardInstance = { uid: s.nextUid++, defId, upgraded: false };
  s.combat!.hand = [card];
  s.combat!.energy = 3;
  expect(playCard(s, 0, target).ok).toBe(true);
}

describe("大史莱姆半血分裂", () => {
  it("酸液大史莱姆降到 ≤半血 → 下回合分裂成 2 只中酸液（HP=当前值）", () => {
    const s = fight("large_slime_acid");
    const boss = s.combat!.enemies[0]!;
    boss.hp = 30; // 手动置到半血以下（maxHp 65-69，半血约 32-34）
    boss.maxHp = 66;
    // 打一下触发 onHpLost 分裂标记
    play(s, "strike"); // 6 伤 → hp 24
    expect(s.combat!.enemies[0]!.currentMove).toBe("split");
    endTurn(s); // 分裂执行
    expect(s.combat!.enemies).toHaveLength(2);
    for (const e of s.combat!.enemies) {
      expect(e.defId).toBe("acid_slime_m");
      expect(e.hp).toBe(24); // 各自 = 分裂瞬间 HP
      expect(e.maxHp).toBe(24);
    }
  });

  it("尖刺大史莱姆分裂成 2 只中尖刺", () => {
    const s = fight("large_slime_spike");
    const boss = s.combat!.enemies[0]!;
    boss.hp = 20;
    boss.maxHp = 68;
    play(s, "strike"); // hp 14
    endTurn(s);
    expect(s.combat!.enemies.map(e => e.defId)).toEqual(["spike_slime_m", "spike_slime_m"]);
    expect(s.combat!.enemies.every(e => e.hp === 14)).toBe(true);
  });

  it("只分裂一次（分裂体再半血才各自分裂）", () => {
    const s = fight("large_slime_acid");
    const boss = s.combat!.enemies[0]!;
    boss.hp = 30;
    boss.maxHp = 66;
    play(s, "strike");
    endTurn(s); // 分裂成 2 只中酸液（各 24）
    expect(s.combat!.enemies).toHaveLength(2);
    // 原 large 已消失、不会再分裂出更多
    expect(s.combat!.enemies.every(e => e.defId === "acid_slime_m")).toBe(true);
  });
});

describe("史莱姆王", () => {
  it("HP 140，固定循环 黏液喷射→蓄力→猛砸", () => {
    const s = fight("slime_boss");
    const boss = () => s.combat!.enemies[0]!;
    expect(boss().hp).toBe(140);
    const seq: string[] = [boss().currentMove];
    for (let i = 0; i < 3; i += 1) {
      endTurn(s);
      seq.push(boss().currentMove);
    }
    // 猛砸伤害高，玩家 500 血扛得住；分裂未触发（血量高）
    expect(seq.slice(0, 4)).toEqual(["goop_spray", "preparing", "slam", "goop_spray"]);
  });

  it("黏液喷射塞 3 张泥泞、猛砸造成 35", () => {
    const s = fight("slime_boss");
    // 黏液喷射（首招）
    const before = s.combat!.discardPile.filter(c => c.defId === "slimed").length;
    endTurn(s);
    const after = s.combat!.discardPile.filter(c => c.defId === "slimed").length;
    expect(after - before).toBe(3);

    // 直接驱动到猛砸
    s.combat!.enemies[0]!.currentMove = "slam";
    s.hp = 500;
    s.combat!.playerBlock = 0;
    endTurn(s);
    expect(s.hp).toBe(500 - 35);
  });

  it("降到 ≤70 半血分裂成 大尖刺 + 大酸液（HP=当前值）", () => {
    const s = fight("slime_boss");
    const boss = s.combat!.enemies[0]!;
    boss.hp = 60; // ≤70
    play(s, "strike"); // hp 54 → 触发分裂标记
    expect(boss.currentMove).toBe("split");
    endTurn(s);
    expect(s.combat!.enemies).toHaveLength(2);
    expect(s.combat!.enemies.map(e => e.defId).sort()).toEqual(["acid_slime_l", "spike_slime_l"]);
    expect(s.combat!.enemies.every(e => e.hp === 54)).toBe(true);
  });

  it("史莱姆王进入 Boss 随机池", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 90; seed += 1) {
      seen.add(pickBossEncounter(seedRng(seed)));
    }
    expect(seen.has("slime_boss")).toBe(true);
  });
});
