import { describe, expect, it } from "vitest";
import { newRun } from "../src/engine/engine.js";
import { startCombat, playCard, endTurn } from "../src/engine/combat/combat.js";
import { getPower } from "../src/engine/powers/powers.js";
import type { CardInstance, GameState } from "../src/engine/types.js";

// A-mob：拾荒者（偷金+逃跑）+ 红色奴隶主（缠绕）。asc0。

function fight(encounter: string): GameState {
  const s = newRun({ runId: encounter, seed: 1 });
  startCombat(s, encounter);
  s.hp = 300;
  s.maxHp = 300;
  return s;
}

describe("拾荒者：偷金 + 逃跑", () => {
  it("抢劫偷 15 金并造成 10 伤", () => {
    const s = fight("looter");
    s.gold = 100;
    s.combat!.hand = [];
    expect(s.combat!.enemies[0]!.currentMove).toBe("mug"); // 首招抢劫
    endTurn(s);
    expect(s.gold).toBe(85); // 偷 15
    expect(s.hp).toBe(290); // 10 伤
  });

  it("金币不足则偷光、不为负", () => {
    const s = fight("looter");
    s.gold = 5;
    s.combat!.hand = [];
    endTurn(s);
    expect(s.gold).toBe(0);
  });

  it("出招序列：抢劫→抢劫→(猛扑/烟雾弹)→…→逃跑，逃跑后战斗结束", () => {
    const s = fight("looter");
    s.hp = 9999;
    s.maxHp = 9999;
    const looter = () => s.combat?.enemies[0];
    const seq: string[] = [looter()!.currentMove];
    for (let i = 0; i < 6 && s.combat; i += 1) {
      s.combat.hand = [];
      endTurn(s);
      if (s.combat) {
        seq.push(looter()!.currentMove);
      }
    }
    // 序列里应出现逃跑，且逃跑后战斗结束（combat 清空）
    expect(seq).toContain("flee");
    expect(s.combat).toBeNull();
  });
});

describe("红色奴隶主：缠绕", () => {
  it("缠绕期间无法打出攻击牌，技能可打", () => {
    const s = fight("red_slaver");
    s.hp = 300;
    // 手动给玩家缠绕
    s.combat!.playerPowers.push({ id: "entangled", amount: 1 });
    const strike: CardInstance = { uid: s.nextUid++, defId: "strike", upgraded: false };
    s.combat!.hand = [strike];
    s.combat!.energy = 3;
    expect(playCard(s, 0, 0).ok).toBe(false); // 攻击被缠绕挡住
    const defend: CardInstance = { uid: s.nextUid++, defId: "defend", upgraded: false };
    s.combat!.hand = [defend];
    expect(playCard(s, 0, null).ok).toBe(true); // 技能可打
  });

  it("首招刺击 13；缠绕整场只放一次", () => {
    const s = fight("red_slaver");
    s.hp = 300;
    expect(s.combat!.enemies[0]!.currentMove).toBe("rs_stab");
    // 多回合推进，统计 entangle 次数
    let entangleCount = 0;
    for (let i = 0; i < 30; i += 1) {
      if (s.combat!.enemies[0]!.currentMove === "entangle") {
        entangleCount += 1;
      }
      s.hp = 300;
      s.combat!.playerPowers = [];
      s.combat!.hand = [];
      endTurn(s);
    }
    expect(entangleCount).toBeLessThanOrEqual(1);
  });

  it("缠绕回合末解除", () => {
    const s = fight("red_slaver");
    s.hp = 300;
    s.combat!.playerPowers.push({ id: "entangled", amount: 1 });
    s.combat!.hand = [];
    s.combat!.enemies[0]!.currentMove = "rs_stab";
    endTurn(s);
    expect(getPower(s.combat!.playerPowers, "entangled")).toBe(0);
  });
});
