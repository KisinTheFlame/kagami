import model, { type AiToneModelData } from "./ai-tone-model.js";

/**
 * 中文「AI 味」打分器。
 *
 * 逐函数复刻 AIRadar 的 predict.js（TF-IDF 字符 n-gram + 逻辑回归推理）：
 * lowercase → 连续空白折叠 → 按码点切分 → n-gram(1~3) 落表计数 → count*idf →
 * L2 归一化 → 点乘系数 + intercept → sigmoid。来源见 ai-tone-model.data.ts。
 *
 * 模型权重在模块加载时即常驻内存；本类无状态，全程构造一次复用即可。
 */
export class AiToneScorer {
  private readonly model: AiToneModelData;
  private readonly nMin: number;
  private readonly nMax: number;

  public constructor({ modelData = model }: { modelData?: AiToneModelData } = {}) {
    this.model = modelData;
    this.nMin = modelData.ngramRange[0];
    this.nMax = modelData.ngramRange[1];
  }

  /** 与 sklearn 一致：多个连续空白折叠成一个空格；按码点切分（兼容 emoji）。 */
  private preprocess(text: string): string[] {
    let normalized = this.model.lowercase ? text.toLowerCase() : text;
    normalized = normalized.replace(/\s\s+/g, " ");
    return Array.from(normalized);
  }

  /** 返回 P(AI 腔调)，0~1。 */
  public proba(text: string): number {
    const chars = this.preprocess(text);
    const { ngrams } = this.model;

    // 统计落在词表内的 n-gram 计数。
    const counts = new Map<string, number>();
    for (let n = this.nMin; n <= this.nMax; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const gram = chars.slice(i, i + n).join("");
        if (Object.prototype.hasOwnProperty.call(ngrams, gram)) {
          counts.set(gram, (counts.get(gram) ?? 0) + 1);
        }
      }
    }

    // tfidf = count * idf，再做 L2 归一化，最后点乘系数。
    let norm = 0;
    const weighted: Array<[number, number]> = [];
    for (const [gram, count] of counts) {
      const [idf, coef] = ngrams[gram];
      const value = count * idf;
      norm += value * value;
      weighted.push([value, coef]);
    }
    norm = Math.sqrt(norm) || 1; // 空文本保护

    let score = this.model.intercept;
    for (const [value, coef] of weighted) {
      score += (value / norm) * coef;
    }

    return 1 / (1 + Math.exp(-score)); // sigmoid
  }
}
