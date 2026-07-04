import type { PowerId, PowerInstance } from "../types.js";

// === 状态效果（power）纯helper ===
//
// 两类机制（issue #234 C5）：
//   - 被动修正器（strength/vulnerable/weak）：只改伤害结算，无钩子。
//   - 时机触发（ritual on_turn_start / curl_up on_attacked）：由 combat 在对应触发点调用。

export function getPower(powers: readonly PowerInstance[], id: PowerId): number {
  return powers.find(power => power.id === id)?.amount ?? 0;
}

/** 叠加一层 power（可负，用于衰减）；归零或转负的 vulnerable/weak 会被清除。 */
export function addPower(powers: PowerInstance[], id: PowerId, delta: number): void {
  const existing = powers.find(power => power.id === id);
  if (existing) {
    existing.amount += delta;
  } else if (delta !== 0) {
    powers.push({ id, amount: delta });
  }
  pruneEmpty(powers, id);
}

function pruneEmpty(powers: PowerInstance[], id: PowerId): void {
  const index = powers.findIndex(power => power.id === id);
  if (index < 0) {
    return;
  }
  const amount = powers[index]!.amount;
  // 力量 / 敏捷可为负并保留；易伤/虚弱/脆弱/缠绕降到 0 即移除。
  if (
    (id === "vulnerable" || id === "weak" || id === "frail" || id === "entangled") &&
    amount <= 0
  ) {
    powers.splice(index, 1);
  } else if (amount === 0 && id !== "strength" && id !== "dexterity") {
    powers.splice(index, 1);
  }
}

/** 直接移除某个 power（不衰减，一次清空）。用于守卫者离开防御姿态时清反甲。 */
export function removePower(powers: PowerInstance[], id: PowerId): void {
  const index = powers.findIndex(power => power.id === id);
  if (index >= 0) {
    powers.splice(index, 1);
  }
}

/** 回合末衰减：易伤 / 虚弱 / 脆弱 / 缠绕各 -1。 */
export function decayDebuffs(powers: PowerInstance[]): void {
  if (getPower(powers, "vulnerable") > 0) {
    addPower(powers, "vulnerable", -1);
  }
  if (getPower(powers, "weak") > 0) {
    addPower(powers, "weak", -1);
  }
  if (getPower(powers, "frail") > 0) {
    addPower(powers, "frail", -1);
  }
  if (getPower(powers, "entangled") > 0) {
    addPower(powers, "entangled", -1);
  }
  if (getPower(powers, "lock_on") > 0) {
    addPower(powers, "lock_on", -1);
  }
}

/**
 * 计算实际获得的格挡：基础 + 敏捷 → ×脆弱0.75 → 向下取整、不低于 0。
 * 作用于「获得格挡的一方」的 powers（敏捷可负）。
 */
export function computeBlockGain(amount: number, gainerPowers: readonly PowerInstance[]): number {
  let value = amount + getPower(gainerPowers, "dexterity");
  if (value < 0) {
    value = 0;
  }
  if (getPower(gainerPowers, "frail") > 0) {
    value = Math.floor(value * 0.75);
  }
  return value;
}

/**
 * 攻击伤害结算（顺序必须忠实，issue #234）：
 *   基础 + 力量 → ×虚弱(攻击方 0.75) → ×易伤(目标 1.5) → 向下取整。
 * 只作用于「攻击型」伤害；lose_hp 等无视此函数直接扣血。
 */
export function computeAttackDamage(
  base: number,
  attackerPowers: readonly PowerInstance[],
  defenderPowers: readonly PowerInstance[],
  strengthMultiplier = 1,
): number {
  let amount = base + getPower(attackerPowers, "strength") * strengthMultiplier;
  if (amount < 0) {
    amount = 0;
  }
  if (getPower(attackerPowers, "weak") > 0) {
    amount = Math.floor(amount * 0.75);
  }
  if (getPower(defenderPowers, "vulnerable") > 0) {
    amount = Math.floor(amount * 1.5);
  }
  return amount;
}
