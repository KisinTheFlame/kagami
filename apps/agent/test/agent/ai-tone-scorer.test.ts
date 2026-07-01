import { describe, expect, it } from "vitest";
import { AiToneScorer } from "../../src/agent/capabilities/messaging/infra/ai-tone-scorer.js";

/**
 * Parity 测试：TS 移植的 AiToneScorer 必须与 AIRadar 原版 predict.js 推理逐位一致
 * （容差 1e-9，吸收浮点累加顺序差异）。
 *
 * 期望值由原版 predict.js 在 vendored 的同一份 model.json
 * （源 commit 744a436827bc66ea3ab3afae5099a73bdf2f1498）上全精度算出后写死。
 */
const REFERENCE: ReadonlyArray<readonly [string, number]> = [
  ["在吗", 0.03456659556928273],
  ["哈哈", 0.128746602613869],
  ["好的", 0.24885766038818768],
  ["蚌埠住了", 0.17857580254402602],
  ["精准打击", 0.6037556811809015],
  ["某种程度上，这本质上揭示了我们与工具之间的深层关系——值得深思", 0.5229478994632043],
  ["这玩意儿我昨天也碰到了，重启一下就好了，别折腾", 0.08734178365583856],
  ["", 0.06491291874012291],
  ["a", 0.15438443741664987],
  ["AI 真的很强 😂 但有时候也挺蠢的", 0.4438427355974182],
  ["这不是结束，而是开始；这不是失败，而是成长；这才是真正的意义所在。", 0.9276913013326162],
];

describe("AiToneScorer", () => {
  const scorer = new AiToneScorer();

  it("与 predict.js 全精度参考值逐位一致（容差 1e-9）", () => {
    for (const [text, expected] of REFERENCE) {
      expect(scorer.proba(text)).toBeCloseTo(expected, 9);
    }
  });

  it("打分始终落在 [0, 1]", () => {
    for (const [text] of REFERENCE) {
      const p = scorer.proba(text);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("短口语消息够不到 0.8 拦截线（短文本天然被阈值保护）", () => {
    for (const text of ["在吗", "哈哈", "好的", "蚌埠住了", "笑死", "我去"]) {
      expect(scorer.proba(text)).toBeLessThan(0.8);
    }
  });

  it("堆叠『不是X而是Y』+ 破折号的明显 AI 腔会越过 0.8", () => {
    expect(
      scorer.proba("这不是结束，而是开始；这不是失败，而是成长；这才是真正的意义所在。"),
    ).toBeGreaterThanOrEqual(0.8);
  });

  it("emoji 按码点切分，不抛错", () => {
    expect(() => scorer.proba("好耶🎉🎉🎉")).not.toThrow();
  });
});
