import type { HealthResponse } from "./schemas/health.js";

export function createHealthResponse(): HealthResponse {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}

/** 小镜的生活时区（北京）。所有面向用户的时间展示统一走这个时区，别在各处重复字面量。 */
export const BEIJING_TIME_ZONE = "Asia/Shanghai";

/**
 * 把 Date 格式化成北京时区的 `zh-CN` 年月日时分（24 小时制、分钟补零）。各 App 屏幕
 * （HN / IThome …）与上下文时间展示共用同一份，保证进 LLM 上下文的时间文案格式一致。
 */
export function formatBeijingDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

/**
 * 剥除落单的 UTF-16 代理项（unpaired surrogate）：孤立的高代理（U+D800–U+DBFF 后面没有
 * 配对低代理）或孤立的低代理（U+DC00–U+DFFF）。这种半个字符会让 JSON 非法——Anthropic 等
 * 上游会以 "no low surrogate in string" 400 掉整个请求。任何外部文本进入 Agent 上下文前都应
 * 先过这层，避免半个 emoji 把整条会话打挂（见「引用预览按 UTF-16 长度截断劈开代理对」事故）。
 */
export function stripLoneSurrogates(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // 高代理：仅当紧跟低代理时才是合法 emoji，成对保留；否则丢弃这半个。
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // 落单的低代理：丢弃。
    } else {
      out += text[i];
    }
  }
  return out;
}

/**
 * 按 Unicode 码点安全截断：绝不从代理对（emoji）中间切开。先剥除输入里已有的落单代理项，
 * 再按码点数截断——超过 maxCodePoints 时截到该长度并追加 ellipsis（默认 …）。
 *
 * maxCodePoints 以「码点」计（一个 emoji 记 1），不是 UTF-16 码元；这正是 `.slice(0, n)`
 * 会劈开代理对、而本函数不会的原因。
 */
export function truncateWithEllipsis(text: string, maxCodePoints: number, ellipsis = "…"): string {
  const clean = stripLoneSurrogates(text);
  const codePoints = Array.from(clean); // 字符串迭代器按码点拆分，emoji 是单个元素
  if (codePoints.length <= maxCodePoints) {
    return clean;
  }
  return codePoints.slice(0, maxCodePoints).join("") + ellipsis;
}
