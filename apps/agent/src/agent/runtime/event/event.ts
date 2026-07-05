import type { AsyncTaskCompletion } from "@kagami/agent-runtime";

/**
 * 聚合后的通知事件，由 NotificationCenter 在窗口 flush 时塞进事件队列（手机 OS
 * 模型里 center 是**后台 / 非焦点**信号到 Agent 的唯一桥——「横幅」；前台当前会话的
 * 实时输入走 `foreground_input` 直达——「屏幕」）。每个 source 一行 `lines`。Session
 * 路由时装配成一条 `<notification>` user message 追加到上下文尾部，并触发一轮 round。
 * 这条事件进队列本身就是「唤醒」——见 Queue 的 wake-up generality。
 */
type NotificationEvent = {
  type: "notification";
  data: {
    /** 每个源一行，已渲染好的展示文本。 */
    lines: string[];
  };
};

/**
 * Pure wake event. Produced by internal mechanisms (wait tool timers,
 * stop requests, reset notifications) that need to unblock a consumer
 * waiting on the event queue but have no business-level content to convey.
 *
 * Session routing treats it as a no-op.
 */
type WakeEvent = {
  type: "wake";
};

/**
 * 异步工具任务完成后，AsyncTaskManager 的 onComplete 把结果以事件形式塞回主 Agent
 * 的事件队列。Session 路由时装配成一条 `<async_tool_result>` user message 追加到上下文，
 * 并触发新一轮 round，让主 Agent 凭 task_id 对应到当初的发起。
 */
type AsyncToolResultCompletedEvent = {
  type: "async_tool_result_completed";
  data: AsyncTaskCompletion;
};

/**
 * 前台输入敲门事件。当前前台 App 的「屏幕」上出现实时输入（如 QQ 当前会话来了新消息）
 * 时，App 经注入的敲门端口 enqueue 本事件。刻意**不带内容、不带来源**：内容在 drain 时
 * 由 session 向**当前**前台 App 现拉（永不 stale）；不带来源使 stale 事件天然安全——
 * 焦点已切走时向当前 App 拉空即 no-op，drain 的语义是「拉当前前台的未消费增量」，
 * 不存在错投。事件是通用原语，QQ 只是首个消费者。
 */
type ForegroundInputEvent = {
  type: "foreground_input";
};

/**
 * 内心独白事件：摸鱼判定触发、inner-voice Operation 产出非空念头后塞进队列
 * （issue #265）。Session 路由时装配成一条 `<inner_thought>` user message 追加到
 * 上下文尾部并触发一轮 round；enqueue 本身兼作唤醒（她摸鱼时多半正阻塞在 wait 里）。
 */
type InnerThoughtEvent = {
  type: "inner_thought";
  data: {
    /** 已经以小镜口吻写好的第一人称念头文本。 */
    thought: string;
  };
};

export type Event =
  | NotificationEvent
  | AsyncToolResultCompletedEvent
  | ForegroundInputEvent
  | WakeEvent
  | InnerThoughtEvent;
