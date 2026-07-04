import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// 尸爆（毒 + 死亡扩散毒）/ 自我修复（战斗结束回血）。

function combat(character: "silent" | "defect", enemyId = "cultist"): GameState {
  const s = newRun({ runId: "cp", seed: 53, character });
  startCombat(s, enemyId);
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("尸爆：目标死亡时把毒扩散给其余敌人", () => {
  it("双敌：给甲上毒+尸爆，甲毒死后乙获得毒", () => {
    const s = combat("silent");
    // 造出第二个敌人。
    s.combat!.enemies.push({ ...s.combat!.enemies[0]! });
    const [a, b] = s.combat!.enemies;
    a!.hp = 6;
    a!.maxHp = 40;
    b!.hp = 40;
    b!.maxHp = 40;
    b!.powers = [];
    const card: CardInstance = { uid: s.nextUid++, defId: "corpse_explosion", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true); // 甲：易伤1 + 毒6 + 尸爆
    expect(getPower(a!.powers, "poison")).toBe(6);
    expect(getPower(a!.powers, "corpse_bomb")).toBe(1);
    // 结束回合 → 敌人回合开始甲中毒 6 掉血（6hp）死亡 → 扩散 6 毒给乙。
    s.combat!.hand = [];
    a!.currentMove = "incantation";
    b!.currentMove = "incantation";
    endTurn(s);
    expect(s.combat!.enemies[0]!.hp).toBe(0); // 甲死
    // 乙先获得扩散来的 6 毒，随后在同一敌人阶段跑自己的中毒结算（-6 血、毒 -1）→ 剩 5。
    expect(getPower(s.combat!.enemies[1]!.powers, "poison")).toBe(5);
    expect(s.combat!.enemies[1]!.hp).toBe(40 - 6); // 乙因扩散毒掉了 6 血
  });
});

describe("自我修复：战斗结束回血", () => {
  it("挂 self_repair 后击杀敌人 → 回 7 血", () => {
    const s = combat("defect");
    s.hp = 100;
    // 先挂上能力。
    s.combat!.hand = [{ uid: s.nextUid++, defId: "self_repair", upgraded: false }];
    s.combat!.energy = 9;
    expect(playCard(s, 0, null).ok).toBe(true);
    expect(getPower(s.combat!.playerPowers, "self_repair")).toBe(7);
    // 击杀唯一敌人 → 战斗结束 → 回 7 血。
    s.combat!.enemies[0]!.hp = 1;
    s.combat!.enemies[0]!.block = 0;
    const card: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    s.combat!.hand = [card];
    s.combat!.energy = 9;
    expect(playCard(s, 0, 0).ok).toBe(true);
    expect(s.combat).toBeNull(); // 战斗结束
    expect(s.hp).toBe(107);
  });
});
