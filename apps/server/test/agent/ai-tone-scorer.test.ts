import { describe, expect, it } from "vitest";
import { AiToneScorer } from "../../src/agent/capabilities/messaging/infra/ai-tone-scorer.js";

/**
 * Parity 测试：TS 移植的 AiToneScorer 必须与 AIRadar 原版 predict.js 推理逐位一致
 * （容差 1e-9，吸收浮点累加顺序差异）。
 *
 * 期望值由原版 predict.js 在 vendored 的同一份 model.json
 * （源 commit c202ef2845fa439a5e8bfa9bf48fcb0b59be3c81）上全精度算出后写死。
 */
const REFERENCE: ReadonlyArray<readonly [string, number]> = [
  ["在吗", 0.03231817276133425],
  ["哈哈", 0.1477965960192279],
  ["好的", 0.25904461583641153],
  ["蚌埠住了", 0.16891397002917247],
  ["精准打击", 0.6106081777160949],
  ["某种程度上，这本质上揭示了我们与工具之间的深层关系——值得深思", 0.547580618468633],
  ["这玩意儿我昨天也碰到了，重启一下就好了，别折腾", 0.10873102560910183],
  ["", 0.05990325195721118],
  ["a", 0.18266741467476652],
  ["AI 真的很强 😂 但有时候也挺蠢的", 0.42733295260441595],
  ["这不是结束，而是开始；这不是失败，而是成长；这才是真正的意义所在。", 0.9274438251053274],
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
