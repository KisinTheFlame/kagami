/**
 * 前台输入：App 的可选能力（Kagami 语义，不进 kernel 的公共 `App` 接口）。
 *
 * 当前前台 App 的「屏幕」上出现实时输入（首个消费者：QQ 当前会话的新消息）时，App 经
 * factory 注入的敲门端口 enqueue 一个不带内容的 `foreground_input` 事件；drain 时 session
 * 只向**当前**前台 App 拉取待注入文本。内容在 drain 时才现拉，永不 stale；事件不带来源，
 * 焦点已切走时拉空 no-op（stale 敲门天然安全）。
 *
 * 实现契约：
 * - **纯内存短路径**：只读已缓冲内容并渲染，严禁网关 I/O / 慢操作——drain 在
 *   mutationExecutor 串行段内执行，慢操作会卡住整条主循环。
 * - **先渲染后消费**：渲染失败时内部状态必须原封不动（session 侧 catch 后视同拉空，
 *   输入不丢，等下一次机会）。
 * - **焦点自查**：App 自身失焦（如 reset 后悬空）时返回 null——与「session 只问当前
 *   App」构成双重校验，任一侧失同步都不注入。
 * - 返回渲染好的完整文本（含伪标签），session 只做薄包装成 user message，不再套第二层标签。
 *
 * session 从 AppManager 拿到 App 后经 {@link isForegroundInputSource} 判定，是唯一接入
 * 路径；禁止把本接口塞进 kernel 的 `App` 接口。
 */
/**
 * 前台路径的三计数（knock 在敲门端口闭包记录，inject / drain_empty 在 session drain 记录）。
 * 收在一处：这三个名字是观测面板依赖的契约，不许散落漂移。
 */
export const FOREGROUND_METRIC_KNOCK = "agent.foreground.knock";
export const FOREGROUND_METRIC_INJECT = "agent.foreground.inject";
export const FOREGROUND_METRIC_DRAIN_EMPTY = "agent.foreground.drain_empty";

export type ForegroundInput = {
  /** 渲染好的完整注入文本（含伪标签），由 App 的模板产出。 */
  readonly text: string;
  /** 本次注入包含的输入条目数（如消息条数），仅用于 metric 观测。 */
  readonly itemCount: number;
};

export interface ForegroundInputSource {
  drainForegroundInput(): Promise<ForegroundInput | null>;
}

export function isForegroundInputSource(app: unknown): app is ForegroundInputSource {
  return (
    typeof app === "object" &&
    app !== null &&
    typeof (app as { drainForegroundInput?: unknown }).drainForegroundInput === "function"
  );
}
