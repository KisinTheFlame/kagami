import type { AsyncTaskCompletion } from "@kagami/agent-runtime";

/**
 * 聚合后的通知事件，由 NotificationCenter 在窗口 flush 时塞进事件队列（手机 OS
 * 模型里 center 是 App→Agent 的唯一桥）。每个 source 一行 `lines`。Session 路由时
 * 装配成一条 `<notification>` user message 追加到上下文尾部，并触发一轮 round。
 * 这条事件进队列本身就是「唤醒」——见 Queue 的 wake-up generality。
 */
export type NotificationEvent = {
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
export type WakeEvent = {
  type: "wake";
};

/**
 * 异步工具任务完成后，AsyncTaskManager 的 onComplete 把结果以事件形式塞回主 Agent
 * 的事件队列。Session 路由时装配成一条 `<async_tool_result>` user message 追加到上下文，
 * 并触发新一轮 round，让主 Agent 凭 task_id 对应到当初的发起。
 */
export type AsyncToolResultCompletedEvent = {
  type: "async_tool_result_completed";
  data: AsyncTaskCompletion;
};

/**
 * 内心独白事件：摸鱼判定触发、inner-voice Operation 产出非空念头后塞进队列
 * （issue #265）。Session 路由时装配成一条 `<inner_thought>` user message 追加到
 * 上下文尾部并触发一轮 round；enqueue 本身兼作唤醒（她摸鱼时多半正阻塞在 wait 里）。
 */
export type InnerThoughtEvent = {
  type: "inner_thought";
  data: {
    /** 已经以小镜口吻写好的第一人称念头文本。 */
    thought: string;
  };
};

export type Event =
  | NotificationEvent
  | AsyncToolResultCompletedEvent
  | WakeEvent
  | InnerThoughtEvent;
