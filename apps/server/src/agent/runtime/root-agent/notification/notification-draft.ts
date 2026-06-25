/**
 * 一条待发通知的「源自定义」表示（手机 OS 模型）。
 *
 * NotificationCenter 是被动、源无关的：它只按 `sourceId` 归组、按 `merge` 折叠、
 * 调 `render` 渲染，完全不懂任何具体源（ithome / 聊天 …）的语义。所有语义都落在
 * 各源自己实现的 Draft 里。
 *
 * 折叠约定（重要）：`merge(prev)` 里 **this = 最新、prev = 历史**。显示字段取
 * `this`（最新那条），粘性 / 累计字段从 `prev` 继承。这样 survivor（最新对象）
 * 上每个字段都有意义，merge 体里只出现「依赖历史」的字段。
 *
 * 设计依据：手机 OS 模型设计文档（NotificationCenter / 折叠契约）。
 */
export interface NotificationDraft {
  /** 不透明源标识（appId / stateId）。NotificationCenter 按它归组、折叠、清空。 */
  readonly sourceId: string;
  /** 给人看的源短名，渲染时可用。 */
  readonly displayName: string;
  /** 把同源的历史 draft 折叠进来。this = 最新、prev = 历史。 */
  merge(prev: NotificationDraft): NotificationDraft;
  /** 折成一行展示文本（flush 时调用）。 */
  render(): string;
}
