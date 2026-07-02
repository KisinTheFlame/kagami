import { describe, expect, it } from "vitest";
import { lookupReference } from "../src/application/reference.js";

describe("lookupReference", () => {
  it("空 query 返回全部卡牌与术语", () => {
    const ref = lookupReference("");
    expect(ref.cards.length).toBeGreaterThan(10);
    expect(ref.terms.length).toBeGreaterThan(5);
  });

  it("按术语名匹配", () => {
    const ref = lookupReference("易伤");
    expect(ref.terms.map(t => t.term)).toContain("易伤");
    expect(ref.terms[0]?.definition).toContain("50%");
  });

  it("按术语英文别名匹配", () => {
    const ref = lookupReference("vulnerable");
    expect(ref.terms.map(t => t.term)).toContain("易伤");
  });

  it("按卡名匹配，带 base/upgraded 费用", () => {
    const ref = lookupReference("打击");
    const strike = ref.cards.find(c => c.name === "打击");
    expect(strike).toBeDefined();
    expect(strike?.cost).toBe(1);
    expect(strike?.description).toContain("6");
  });

  it("力压升级后费用降为 0", () => {
    const ref = lookupReference("力压");
    const bodySlam = ref.cards.find(c => c.name === "力压");
    expect(bodySlam?.cost).toBe(1);
    expect(bodySlam?.upgradedCost).toBe(0);
  });

  it("查不到时卡与术语都为空", () => {
    const ref = lookupReference("不存在的东西xyz");
    expect(ref.cards).toHaveLength(0);
    expect(ref.terms).toHaveLength(0);
  });
});
