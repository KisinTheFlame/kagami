import { readServerStaticText } from "@kagami/server-core/common/runtime/read-static-text";

/**
 * 中文「AI 味」检测器的模型权重类型（TF-IDF 字符 n-gram + 逻辑回归）。
 *
 * 权重本体是 ~700KB 纯数据，存为静态 JSON（apps/server/static/ai-tone-model.json）、运行时
 * 加载——避免 ~700KB 字面量进 TS 编译 / lint，不再需要整文件类型检查豁免。
 *
 * 来源：https://github.com/Hei-AI/AIRadar（model.json，源 commit
 * c202ef2845fa439a5e8bfa9bf48fcb0b59be3c81）。vendored 快照，更新需手动重拉 JSON 并重跑
 * parity 单测（ai-tone-scorer.test.ts）。致谢原作者 Hei-AI。
 */
export interface AiToneModelData {
  readonly ngramRange: readonly [number, number];
  readonly lowercase: boolean;
  readonly intercept: number;
  readonly ngrams: Readonly<Record<string, readonly [number, number]>>;
}

// JSON.parse 返回 any，用 as 在这唯一的无类型边界上收口（数据可信、parity 单测兜底）。
const model = JSON.parse(
  readServerStaticText(import.meta.url, "ai-tone-model.json"),
) as AiToneModelData;

export default model;
