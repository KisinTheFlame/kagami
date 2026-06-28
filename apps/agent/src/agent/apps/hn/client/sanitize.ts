import { parse } from "node-html-parser";

/**
 * 把 Hacker News 的富文本（title / text / comment_text / about）转成干净纯文本。
 *
 * 为什么必须做（Codex 冷读 #9）：
 *   - HN 字段是 HTML 片段，含实体（`&#x2F;` `&#x27;`）和标签（`<a>` `<p>` `<i>` `<pre>`）。
 *   - 渲染模板 `noEscape: true`（read-static-text.ts），直接塞进上下文会把 HTML 原样喂给 LLM。
 *   - 更要命的是：上下文按约定用 XML 标签分段（<hn_thread> 之类），不可信的 HN 文本若含
 *     `</hn_thread>` 这样的串就能"越狱"破坏结构 / 注入。
 *
 * 处理顺序：
 *   1. `<p>` / `<br>` → 换行（保留段落感）。
 *   2. node-html-parser 取 textContent：去标签 + 解码实体（健壮，复用 ithome 已用的库）。
 *   3. 残余尖括号 `<` `>` 软化为 `‹` `›`：解码后若文本里还原出 `<foo>`（来自 `&lt;foo&gt;`），
 *      也无法再被当成结构标签。代价是代码片段里的尖括号会变全角——对"小镜阅读 HN"可接受。
 */
export function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(/<\s*\/\s*p\s*>/gi, "\n\n").replace(/<\s*br\s*\/?\s*>/gi, "\n");
  const text = parse(withBreaks).textContent;
  return neutralizeAngleBrackets(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function neutralizeAngleBrackets(value: string): string {
  return value.replace(/</g, "‹").replace(/>/g, "›");
}
