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

export type TruncatedText = {
  text: string;
  /** 是否真的发生了截断（用于「内容过长」类提示 / 落库标记）。 */
  truncated: boolean;
};

/**
 * 按 Unicode 码点安全截断并报告是否截断——**全仓截断逻辑的唯一实现**。绝不从代理对
 * （emoji）中间切开：先剥除输入里已有的落单代理项，再按码点数截断，超出时截到该长度并
 * 追加 ellipsis（默认 …）。
 *
 * maxCodePoints 以「码点」计（一个 emoji 记 1），不是 UTF-16 码元；这正是 `.slice(0, n)`
 * 会劈开代理对、而本函数不会的原因。半个 emoji 进上下文会让上游以 "no low surrogate"
 * 400 掉整条请求、每轮复发（见事故「半个 emoji 打挂会话」），所以任何外部文本在进入
 * Agent 上下文前都必须走这里，不要再就地手写 slice / Array.from。
 *
 * - `ellipsis`：截断后缀，按站点排版需要给（省略号计在 maxCodePoints **之外**）。
 * - `trimEnd`：截断分支里，追加后缀前先去掉正文尾部空白（避免「正文 …」这种空格夹缝）。
 */
export function truncateWithEllipsisDetailed(
  text: string,
  maxCodePoints: number,
  options?: { ellipsis?: string; trimEnd?: boolean },
): TruncatedText {
  const clean = stripLoneSurrogates(text);
  const codePoints = Array.from(clean); // 字符串迭代器按码点拆分，emoji 是单个元素
  if (codePoints.length <= maxCodePoints) {
    return { text: clean, truncated: false };
  }

  const body = codePoints.slice(0, Math.max(0, maxCodePoints)).join("");
  return {
    text: `${options?.trimEnd ? body.trimEnd() : body}${options?.ellipsis ?? "…"}`,
    truncated: true,
  };
}

/** {@link truncateWithEllipsisDetailed} 的便捷封装：只要结果文本、不关心是否截断。 */
export function truncateWithEllipsis(text: string, maxCodePoints: number, ellipsis = "…"): string {
  return truncateWithEllipsisDetailed(text, maxCodePoints, { ellipsis }).text;
}
